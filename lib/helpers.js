// helpers.js
import GeoViewport from '@mapbox/geo-viewport';
import { Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');

const ts = () => new Date().toISOString();
const log = (...a) => {
  try {
    console.debug(...a);
  } catch {
  }
};

export const isFiniteCoord = (c) =>
  !!c &&
  typeof c.latitude === 'number' &&
  typeof c.longitude === 'number' &&
  Number.isFinite(c.latitude) &&
  Number.isFinite(c.longitude) &&
  Math.abs(c.latitude) <= 90 &&
  Math.abs(c.longitude) <= 180;

export const isMarker = (child) => {
  try {
    return (
      !!child &&
      !!child.props &&
      !!child.props.coordinate &&
      isFiniteCoord(child.props.coordinate) &&
      child.props.cluster !== false
    );
  } catch {
    return false;
  }
};

export const calculateBBox = (region) => {
  if (!region) return [-180, -85, 180, 85];
  const lngD = region.longitudeDelta < 0 ? region.longitudeDelta + 360 : region.longitudeDelta;
  return [
    region.longitude - lngD,
    region.latitude - region.latitudeDelta,
    region.longitude + lngD,
    region.latitude + region.latitudeDelta,
  ];
};

export const returnMapZoom = (region, bBox, minZoom) => {
  try {
    const viewport =
      region?.longitudeDelta >= 40
        ? { zoom: minZoom }
        : GeoViewport.viewport(bBox, [width, height]);
    return viewport.zoom ?? minZoom ?? 1;
  } catch (e) {
    log(ts(), '[cluster] returnMapZoom error:', e?.message || e);
    return minZoom ?? 1;
  }
};

const _removeChildrenFromProps = (props) => {
  const newProps = {};
  Object.keys(props || {}).forEach((k) => {
    if (k !== 'children') newProps[k] = props[k];
  });
  return newProps;
};

export const markerToGeoJSONFeature = (marker, index) => {
  try {
    if (!marker || !marker.props) return null;
    const c = marker.props.coordinate;
    if (!isFiniteCoord(c)) return null;

    const stableKey =
      (marker.key && String(marker.key)) ||
      (marker.props.identifier && String(marker.props.identifier)) ||
      `mk-${index}`;

    return {
      type: 'Feature',
      geometry: { coordinates: [c.longitude, c.latitude], type: 'Point' },
      properties: {
        point_count: 0,
        index,
        _stableKey: stableKey,
        ..._removeChildrenFromProps(marker.props),
      },
    };
  } catch (e) {
    log(ts(), 'markerToGeoJSONFeature exception:', e?.message || e);
    return null;
  }
};

export const generateSpiral = (clusterFeature, clusterLeaves, allClusters, idxInMarkers) => {
  try {
    const { properties, geometry } = clusterFeature || {};
    const count = properties?.point_count ?? 0;
    const center = geometry?.coordinates;
    if (!center || count <= 0) return [];

    const res = [];
    const total = Array.isArray(clusterLeaves) ? clusterLeaves.length : count;
    for (let i = 0; i < total; i++) {
      const angle = 0.25 * (i * 0.5);
      const latitude = center[1] + 0.00015 * angle * Math.cos(angle);
      const longitude = center[0] + 0.00015 * angle * Math.sin(angle);
      const leaf = clusterLeaves?.[i];
      const childIndex = leaf?.properties?.index;
      if (Number.isInteger(childIndex)) {
        res.push({
          index: childIndex,
          longitude,
          latitude,
          centerPoint: { latitude: center[1], longitude: center[0] },
        });
      }
    }
    return res;
  } catch (e) {
    log(ts(), '[cluster] generateSpiral error:', e?.message || e);
    return [];
  }
};

export const returnMarkerStyle = (points) => {
  if (points >= 50) return { width: 84, height: 84, size: 64, fontSize: 20 };
  if (points >= 25) return { width: 78, height: 78, size: 58, fontSize: 19 };
  if (points >= 15) return { width: 72, height: 72, size: 54, fontSize: 18 };
  if (points >= 10) return { width: 66, height: 66, size: 50, fontSize: 17 };
  if (points >= 8) return { width: 60, height: 60, size: 46, fontSize: 17 };
  if (points >= 4) return { width: 54, height: 54, size: 40, fontSize: 16 };
  return { width: 48, height: 48, size: 36, fontSize: 15 };
};
