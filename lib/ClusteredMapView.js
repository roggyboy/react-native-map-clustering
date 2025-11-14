// ClusteredMapView.js
import React, {
  memo,
  useState,
  useEffect,
  useMemo,
  useRef,
  forwardRef,
} from 'react';
import { Dimensions, Platform } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import SuperCluster from 'supercluster';
import ClusterMarker from './ClusteredMarker';
import {
  isMarker,
  markerToGeoJSONFeature,
  calculateBBox,
  returnMapZoom,
  generateSpiral,
  isFiniteCoord,
} from './helpers';

const ts = () => new Date().toISOString();
const log = (...a) => {
  try {
    if (__DEV__) {
      console.debug(...a);
    }
  } catch {
  }
};

const ClusteredMapView = forwardRef(
    (
      {
        radius = Dimensions.get('window').width * 0.06,
        maxZoom = 17,
        minZoom = 1,
        minPoints = 2,
        extent = 512,
        nodeSize = 64,
        edgePadding = { top: 50, left: 50, right: 50, bottom: 50 },
        children,
        onClusterPress = () => {
        },
        onRegionChangeComplete = () => {
        },
        onMarkersChange = () => {
        },
        preserveClusterPressBehavior = false,
        clusteringEnabled = true,
        clusterColor = '#00B386',
        clusterTextColor = '#FFFFFF',
        clusterFontFamily,
        spiderLineColor = '#FF0000',
        animationEnabled = false,
        renderCluster,
        tracksViewChanges = false,
        spiralEnabled = true,
        superClusterRef = {},
        mapRef: mapRefProp = () => {
        },
        ...restProps
      },
      ref,
    ) => {
      const [markers, updateMarkers] = useState([]);
      const [spiderMarkers, updateSpiderMarker] = useState([]);
      const [otherChildren, updateChildren] = useState([]);
      const [superCluster, setSuperCluster] = useState(null);
      const [currentRegion, updateRegion] = useState(
        restProps.region || restProps.initialRegion,
      );
      const [isSpiderfier, updateSpiderfier] = useState(false);
      const isSpiderfierRef = useRef(isSpiderfier);
      const [clusterChildren, updateClusterChildren] = useState(null);
      const mapRef = useRef();
      const lastGoodRef = useRef({ sc: null, markers: [], others: [] });

      const propsChildren = useMemo(
        () => React.Children.toArray(children || []).filter(Boolean),
        [children],
      );

      // Build / rebuild clusters
      useEffect(() => {
        try {
          const rawData = [];
          const others = [];

          if (!clusteringEnabled) {
            updateSpiderMarker([]);
            updateMarkers([]);
            updateChildren(propsChildren);
            setSuperCluster(null);
            log(ts(), '[cluster] disabled. raw=', propsChildren.length);
            return;
          }

          propsChildren.forEach((child, index) => {
            if (isMarker(child)) {
              const feat = markerToGeoJSONFeature(child, index);
              if (feat) rawData.push(feat);
            } else {
              others.push(child);
            }
          });

          const validData = rawData.filter(Boolean);
          if (rawData.length > 0 && validData.length === 0 && lastGoodRef.current.sc) {
            // hold previous cluster state if feed flickers
            log(ts(), '[cluster] skip rebuild (raw>0 but valid=0) – keep previous');
            updateMarkers(lastGoodRef.current.markers);
            updateChildren(lastGoodRef.current.others);
            superClusterRef.current = lastGoodRef.current.sc;
            return;
          }

          const sc = new SuperCluster({
            radius,
            maxZoom,
            minZoom,
            minPoints,
            extent,
            nodeSize,
          });
          sc.load(validData);

          const baseRegion = currentRegion || restProps.initialRegion || restProps.region;
          const bBox = calculateBBox(baseRegion);
          const zoomFloat = returnMapZoom(baseRegion, bBox, minZoom);
          const z = Math.max(minZoom, Math.min(maxZoom, Math.floor(zoomFloat)));
          const nextMarkers = sc.getClusters(bBox, z) || [];

          if (Platform.OS === 'ios') {
            // Phase 1: clear the marker layer (easy for MapKit to clean up)
            updateSpiderMarker([]);
            updateMarkers([]);
            // Phase 2: insert everything in the next frame
            requestAnimationFrame(() => {
              setSuperCluster(sc);
              superClusterRef.current = sc;
              updateChildren(others);
              updateMarkers(nextMarkers);
              lastGoodRef.current = { sc, markers: nextMarkers, others };
            });
          } else {
            updateMarkers(nextMarkers);
            updateChildren(others);
            setSuperCluster(sc);
            superClusterRef.current = sc;
            lastGoodRef.current = { sc, markers: nextMarkers, others };
          }

        } catch (e) {
          log(ts(), '[cluster] init error:', e?.message || e);
          if (lastGoodRef.current.sc) {
            updateMarkers(lastGoodRef.current.markers);
            updateChildren(lastGoodRef.current.others);
            superClusterRef.current = lastGoodRef.current.sc;
          } else {
            updateMarkers([]);
            updateChildren(propsChildren);
            setSuperCluster(null);
          }
        }
      }, [propsChildren, clusteringEnabled]);

      // Spiderfy
      useEffect(() => {
        try {
          if (!spiralEnabled) {
            updateSpiderMarker([]);
            return;
          }
          if (isSpiderfier && markers.length > 0) {
            const all = [];
            markers.forEach((m, i) => {
              if (m?.properties?.cluster) {
                const leaves = superCluster?.getLeaves(m.properties.cluster_id, Infinity) || [];
                const positions = generateSpiral(m, leaves, markers, i);
                if (positions?.length) all.push(...positions);
              }
            });
            updateSpiderMarker(all);
          } else {
            updateSpiderMarker([]);
          }
        } catch (e) {
          log(ts(), '[cluster] spiderfy error:', e?.message || e);
          updateSpiderMarker([]);
        }
      }, [isSpiderfier, markers, spiralEnabled, superCluster]);


      useEffect(() => {
        isSpiderfierRef.current = isSpiderfier;
      }, [isSpiderfier]);

      // Region change
      const handleRegionChangeComplete = (region, details) => {
        try {
          if (superCluster && region) {
            const bBox = calculateBBox(region);
            const zoomFloat = returnMapZoom(region, bBox, minZoom);
            const z = Math.max(minZoom, Math.min(maxZoom, Math.floor(zoomFloat)));
            const nextMarkers = superCluster.getClusters(bBox, z) || [];
            const willSpider = z >= maxZoom && nextMarkers.length > 0;
            if (willSpider) {
              log(ts(), 'zoom is ', z, ' update spiderfier');
              if (spiralEnabled && !isSpiderfierRef.current) {
                updateSpiderfier(true);
              }
              if (Platform.OS === 'ios') {
                updateMarkers([]);                       // fase 1: tøm
                requestAnimationFrame(() => {           // fase 2: legg inn nytt settelse {
                  updateMarkers(nextMarkers);
                });// Viktig: tøm spider før vi viser clusters igjen for å unngå overlapp i én frame
              } else {
                log('zoom is ', z, ' will NOT update spiderfier');
                updateMarkers(nextMarkers);
              }
            } else {
              updateSpiderMarker([]);
              if (spiralEnabled && isSpiderfierRef.current) updateSpiderfier(false);
              if (Platform.OS === 'ios') {
                updateMarkers([]);                       // fase 1
                requestAnimationFrame(() => {           // fase 2
                  updateMarkers(nextMarkers);
                });
              } else {
                updateMarkers(nextMarkers);
              }
            }

            onMarkersChange(nextMarkers);
            onRegionChangeComplete && onRegionChangeComplete(region, details, nextMarkers);
            updateRegion(region);
            lastGoodRef.current = { sc: superCluster, markers: nextMarkers, others: otherChildren };

          } else {
            onRegionChangeComplete && onRegionChangeComplete(region, details);
          }
        } catch (e) {
          log(ts(), '[cluster] onRegionChangeComplete error:', e?.message || e);
        }
      };

      const onClusterPressLocal = (cluster) => () => {
        try {
          const cid = cluster?.properties?.cluster_id ?? cluster?.id;
          const children = superCluster?.getLeaves(cid, Infinity) || [];
          updateClusterChildren(children);

          if (preserveClusterPressBehavior) {
            onClusterPress(cluster, children);
            return;
          }

          const coordinates = children
            .map(({ geometry }) => {
              const lat = geometry?.coordinates?.[1];
              const lng = geometry?.coordinates?.[0];
              return (typeof lat === 'number' && typeof lng === 'number')
                ? { latitude: lat, longitude: lng }
                : null;
            })
            .filter(Boolean);

          if (coordinates?.length && mapRef.current?.fitToCoordinates) {
            mapRef.current.fitToCoordinates(coordinates, { edgePadding });
          }

          onClusterPress(cluster, children);
        } catch (e) {
          log(ts(), '[cluster] onClusterPress error:', e?.message || e);
        }
      };

      // Build set of spidered indices to hide originals
      const spiderIndexSet = useMemo(() => {
        const s = new Set();
        for (const sm of spiderMarkers || []) {
          if (Number.isInteger(sm?.index)) s.add(sm.index);
        }
        return s;
      }, [spiderMarkers]);

      const stripZIndex = (style) => {
        if (!style) return style;
        if (Array.isArray(style)) return style.map(stripZIndex);
        const { zIndex, ...rest } = (style || {});
        return rest;
      };

      const renderSingles = () => {
        try {
          const markersToReturn = markers
            .map((m) => {
              if (!m?.properties) return null;
              if (m.properties.point_count !== 0) return null;

              const idx = m.properties.index;
              if (!Number.isInteger(idx)) return null;
              if (idx < 0 || idx >= propsChildren.length) return null;

              if (isSpiderfier && spiderIndexSet.has(idx)) return null;

              const orig = propsChildren[idx];
              if (!orig || !orig.props) return null;
              const c = orig.props.coordinate;
              if (!isFiniteCoord(c)) return null;

              const stableKey =
                orig.key ||
                orig.props.identifier ||
                m.properties._stableKey ||
                `pt-${idx}`;

              const iosProps = Platform.OS === 'ios' ? { style: stripZIndex(orig.props.style) } : {};
              const idProp = Platform.OS === 'ios' ? { identifier: String(stableKey) } : {};
              return React.cloneElement(orig, { key: stableKey, ...idProp, ...iosProps });

            })
            .filter(Boolean);

          if (__DEV__) {
            const seen = new Set();
            for (const el of markersToReturn || []) {
              const k = el?.key;
              if (k != null) {
                if (seen.has(k)) {
                  console.warn('[ReturnSingles] ####### DUPLICATE KEY:', k);
                }
                seen.add(k);
              }
            }
          }
          return markersToReturn;

        } catch (e) {
          log(ts(), '[cluster] render single error:', e?.message || e);
          return [];
        }
      };

      const renderClusters = () => {
        try {
          // When spiderfying (zoom >= maxZoom), suppress cluster markers entirely.
          if (isSpiderfier) return [];

          const clusterMarkers = markers
            .map((m) => {
              if (!m?.properties?.point_count || m.properties.point_count === 0) return null;

              const cid = m?.properties?.cluster_id ?? m?.id;
              const fallbackKey = `${m?.geometry?.coordinates?.[0]}_${m?.geometry?.coordinates?.[1]}`;
              const clusterKey = `cluster-${cid ?? fallbackKey}`;

              if (renderCluster) {
                const el = renderCluster({
                  onPress: onClusterPressLocal(m),
                  clusterColor,
                  clusterTextColor,
                  clusterFontFamily,
                  ...m,
                });
                return React.isValidElement(el) ? React.cloneElement(el, { key: clusterKey }) : el;
              }
              return (
                <ClusterMarker
                  key={clusterKey}
                  {...m}
                  onPress={onClusterPressLocal(m)}
                  clusterColor={
                    restProps.selectedClusterId === cid
                      ? restProps.selectedClusterColor
                      : clusterColor
                  }
                  clusterTextColor={clusterTextColor}
                  clusterFontFamily={clusterFontFamily}
                  tracksViewChanges={tracksViewChanges}
                />
              );
            }).filter(Boolean);
          if (__DEV__) {
            const seen = new Set();
            for (const el of clusterMarkers || []) {
              const k = el?.key;
              if (k != null) {
                if (seen.has(k)) {
                  console.warn('[renderClusters] ####### DUPLICATE KEY:', k);
                }
                seen.add(k);
              }
            }
          }
          return clusterMarkers;
        } catch (e) {
          log(ts(), '[cluster] render cluster error:', e?.message || e);
          return [];
        }
      };

      const renderOthers = () => {
        try {
          return React.Children.toArray(otherChildren || []).filter(Boolean);
        } catch (e) {
          log(ts(), '[cluster] render others error:', e?.message || e);
          return [];
        }
      };

      const renderSpider = () => {
        try {
          if (!isSpiderfier || !(spiderMarkers?.length)) return [];

          const nodes = [];
          const lines = [];
          for (let i = 0; i < (spiderMarkers?.length || 0); i++) {
            const sm = spiderMarkers[i];
            const idx = sm?.index;
            if (!Number.isInteger(idx)) continue;
            if (idx < 0 || idx >= propsChildren.length) continue;
            const child = propsChildren[idx];
            if (!child || !child.props) continue;

            const baseKey = child.key || child.props.identifier || `pt-${idx}`;
            const copyKey = `spider:${baseKey}:${i}`;

            const coord = { latitude: sm.latitude, longitude: sm.longitude };
            if (!isFiniteCoord(coord)) continue;

            const iosProps = Platform.OS === 'ios' ? { style: stripZIndex(child.props.style) } : {};
            const idProp = Platform.OS === 'ios' ? { identifier: String(copyKey) } : {};
            nodes.push(React.cloneElement(child, { key: copyKey, coordinate: coord, ...idProp, ...iosProps }));

            const center = sm.centerPoint;
            if (isFiniteCoord(center)) {
              lines.push(
                <Polyline
                  key={`spiderline:${copyKey}`}
                  coordinates={[center, coord, center]}
                  strokeColor={spiderLineColor}
                  strokeWidth={1}
                />,
              );
            }
          }
          if (__DEV__) {
            const seen = new Set();
            for (const el of [...nodes, ...lines] || []) {
              const k = el?.key;
              if (k != null) {
                if (seen.has(k)) {
                  console.warn('[cluster] ####### DUPLICATE KEY:', k);
                }
                seen.add(k);
              }
            }
          }

          return [...nodes, ...lines];
        } catch (e) {
          log(ts(), '[cluster] render spider error:', e?.message || e);
          return [];
        }
      };

      return (
        <MapView
          {...restProps}
          ref={(map) => {
            mapRef.current = map;
            if (ref) ref.current = map;
            mapRefProp(map);
          }}
          onRegionChangeComplete={handleRegionChangeComplete}
        >
          {(() => {
            // Bygg én flat liste og sjekk dubletter på tvers (dev)
            const a = renderSingles() || [];
            const b = renderClusters() || [];
            const c = renderOthers() || [];
            const d = renderSpider() || [];
            const all = [...a, ...b, ...c, ...d];
            if (__DEV__) {
              const seen = new Set();
              for (const el of all) {
                const k = el?.key;
                if (k != null) {
                  if (seen.has(k)) console.warn('[cluster] DUPLICATE KEY across layers:', k);
                  seen.add(k);
                }
              }
            }
            return all;
          })()}
        </MapView>
      );
    },
  )
;

export default memo(ClusteredMapView);
