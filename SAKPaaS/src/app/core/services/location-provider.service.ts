import {Injectable} from '@angular/core';
import {Observable, BehaviorSubject, throwError, Subject, combineLatest} from 'rxjs';
import {Location} from 'src/app/generated/models';
import {LocationsService} from 'src/app/generated/services';
import {MapService} from './map.service';
import {switchMap, catchError, filter, tap, startWith, map, share} from 'rxjs/operators';
import {PositionCoordinates} from '../models/position-coordinates.model';
import {getDistance as olGetDistance} from 'ol/sphere';
import {SearchService} from './search.service';
import {ActivatedRoute, ParamMap} from '@angular/router';
import {LocationCardService} from './location-card.service';
import {GpsService} from "./gps.service";
import {error} from "selenium-webdriver";

@Injectable({
  providedIn: 'root'
})
export class LocationProviderService {

  private isLoadingLocations = new BehaviorSubject<boolean>(false);
  private lastUpdatedPosition?: PositionCoordinates = null;
  private reload$ = new BehaviorSubject<string>('init');
  private searchLocations$: Observable<Location[]>;
  private mapLocations$: Observable<Location[]>;
  private updatedLocation$ = new BehaviorSubject<Location>(null);

  constructor(
    private locationApiService: LocationsService,
    private locationCardService: LocationCardService,
    private mapService: MapService,
    private searchService: SearchService,
    private activatedRoute: ActivatedRoute,
    private gpsService: GpsService
  ) {
    this.mapLocations$ = this.mapService.getMapCenter().pipe(
      filter(coordinates => !!coordinates),
      filter(_ => this.mapService.getCurrentMapZoomLevel() > MapService.ZOOM_LIMIT),
      filter(newCoordinates => {
        if (this.lastUpdatedPosition !== null
          && olGetDistance(this.lastUpdatedPosition.toArray(), newCoordinates.toArray()) < MapService.MOVE_LIMIT) {
          return false;
        } else {
          this.lastUpdatedPosition = newCoordinates;
          return true;
        }
      }),
      switchMap(coordinates => {
        this.updateLoadingState(true);
        console.log('Loading new locations...');
        return this.locationApiService.searchLocations({coordinates});
      }),
      tap(_ => this.updateLoadingState(false)),
      catchError((error) => {
        this.updateLoadingState(false);
        return throwError(error);
      }),
      share()
    );

    this.searchLocations$ = this.searchService.getLocations();
  }

  public fetchLocations(): Observable<Location[]> {
    return this.activatedRoute.queryParamMap.pipe(
      switchMap(result => {
        const query: ParamMap = result;
        if (query.has('searchTerm')) {
          return this.searchLocations$;
        } else {
          return this.mapLocations$;
        }
      }),
      switchMap((locations) => {
        return this.updatedLocation$.pipe(
          map((updatedLocation) => {
            if (!updatedLocation) {
              return locations;
            }
            this.updatedLocation$.next(null);
            const index = locations.findIndex(
              (fav) => fav.id === updatedLocation.id
            );
            if (!index || index === -1) {
              return locations;
            }
            locations[index] = updatedLocation;
            return locations;
          })
        );
      }),
      tap(locations => {
        this.locationCardService.deselectIfNotInList(locations);
      })
    );
  }

  public reloadLocations(): void {
    this.lastUpdatedPosition = null;
    this.reload$.next('reload');
  }

  public fetchLocationById(id: number) {
    return this.locationApiService.locationsIdGet({id});
  }

  private updateLoadingState(value: boolean) {
    this.isLoadingLocations.next(value);
  }

  public getLoadingLocationsState(): Observable<boolean> {
    return this.isLoadingLocations;
  }

  public getDistanceToLocation(location: Location): Observable<number> {
    const subject$ = this.gpsService.getGpsCoordinates();
    const result$ = new Observable<number>();
    subject$.subscribe(
      (x) => {
        console.log('got new position data!');
        console.log(x);
        subject$.push(x);
        return olGetDistance([x.longitude, x.latitude], x.toArray());
      },
      (err) => {
        console.warn('Error occurred whilst subscribed to gps position!');
        console.warn(err);
      },
      () => {
        console.log('Completed getting GPS Info');
      }
    );
    return result$;
  }

  public updateLocation(location: Location) {
    this.updatedLocation$.next(location);
  }
}
