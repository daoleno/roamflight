import { Vector3, Quaternion } from 'three';
import { geoDistance, geoContains } from 'd3-geo';

export const RADIUS = 100;
export const EARTH_KM = 6371;
export const DEG = Math.PI / 180;

export function toPoint(lon, lat, radius = 1) {
  const c = Math.cos(lat * DEG);
  return new Vector3(
    Math.sin(lon * DEG) * c,
    Math.sin(lat * DEG),
    Math.cos(lon * DEG) * c,
  ).multiplyScalar(radius);
}

export function toCoordinate(point) {
  const n = point.clone().normalize();
  return [Math.atan2(n.x, n.z) / DEG, Math.asin(Math.max(-1, Math.min(1, n.y))) / DEG];
}

export function headingVector(point, degrees) {
  const up = point.clone().normalize();
  const east = new Vector3(up.z, 0, -up.x).normalize();
  if (east.lengthSq() < 0.1) east.set(1, 0, 0);
  const north = up.clone().cross(east).normalize();
  return north
    .multiplyScalar(Math.cos(degrees * DEG))
    .addScaledVector(east, Math.sin(degrees * DEG))
    .normalize();
}

export function headingDegrees(point, forward) {
  const north = headingVector(point, 0);
  const east = headingVector(point, 90);
  return (Math.atan2(forward.dot(east), forward.dot(north)) / DEG + 360) % 360;
}

export function advanceFlight(up, forward, angle, turn = 0) {
  forward.applyAxisAngle(up, -turn).normalize();
  const axis = up.clone().cross(forward).normalize();
  const rotation = new Quaternion().setFromAxisAngle(axis, angle);
  up.applyQuaternion(rotation).normalize();
  forward.applyQuaternion(rotation).addScaledVector(up, -forward.dot(up)).normalize();
}

export function distanceKm(a, b) {
  return geoDistance(a, b) * EARTH_KM;
}

export function findCountry(features, coordinate) {
  return features.find((feature) => geoContains(feature, coordinate))?.properties.ADMIN ?? null;
}

export const departures = {
  africa: {
    coordinate: [10, -29],
    heading: 107,
    destination: ['Cape Town', 'South Africa', 18.4241, -33.9249],
  },
  europe: {
    coordinate: [3, 43.5],
    heading: 60,
    destination: ['Bern', 'Switzerland', 7.4474, 46.948],
  },
  asia: {
    coordinate: [79, 26.5],
    heading: 75,
    destination: ['Kathmandu', 'Nepal', 85.324, 27.7172],
  },
  america: {
    coordinate: [-77, -19],
    heading: 155,
    destination: ['Santiago', 'Chile', -70.6693, -33.4489],
  },
  oceania: {
    coordinate: [165, -46],
    heading: 57,
    destination: ['Wellington', 'New Zealand', 174.7772, -41.2865],
  },
};

export const destinations = [
  ['Windhoek', 'Namibia', 17.0836, -22.5597],
  ['Gaborone', 'Botswana', 25.9231, -24.6282],
  ['Maputo', 'Mozambique', 32.5732, -25.9692],
  ['Antananarivo', 'Madagascar', 47.5079, -18.8792],
  ['Nairobi', 'Kenya', 36.8219, -1.2921],
  ['Cairo', 'Egypt', 31.2357, 30.0444],
  ['Athens', 'Greece', 23.7275, 37.9838],
  ['Rome', 'Italy', 12.4964, 41.9028],
  ['Paris', 'France', 2.3522, 48.8566],
  ['Reykjavik', 'Iceland', -21.9426, 64.1466],
  ['New York', 'United States of America', -74.006, 40.7128],
  ['Lima', 'Peru', -77.0428, -12.0464],
  ['Tokyo', 'Japan', 139.6917, 35.6895],
  ['Sydney', 'Australia', 151.2093, -33.8688],
];
