// ClusteredMarker.js
import React, { memo, useEffect, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { returnMarkerStyle } from './helpers';
import { Platform } from 'react-native';

const ClusteredMarker = ({
                           geometry,
                           properties,
                           onPress,
                           clusterColor,
                           clusterTextColor,
                           clusterFontFamily,
                           tracksViewChanges,
                         }) => {
  // Start with true on Android if the parent requests it, turn off after a short time
  const [tvc, setTvc] = useState(Platform.OS === 'android' ? !!tracksViewChanges : !!tracksViewChanges);

  useEffect(() => {
    if (Platform.OS === 'android' && tvc) {
      const t = setTimeout(() => setTvc(false), 400);
      return () => clearTimeout(t);
    }
  }, [tvc, properties?.cluster_id]); // new cluster ID → new short phase with tvc=true

  const points = properties?.point_count ?? 0;
  const { width, height, fontSize, size } = returnMarkerStyle(points);

  const lat = geometry?.coordinates?.[1];
  const lng = geometry?.coordinates?.[0];
  const coordinateOk =
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng);

  if (!coordinateOk) return null;

  const keyBase =
    (properties && properties.cluster_id && `cluster-${properties.cluster_id}`) ||
    `${lng}_${lat}`;


  const safeOnPress = (e) => {
    if (__DEV__) console.debug('[cluster] marker.onPress', {
      cid: properties?.cluster_id,
      count: properties?.point_count,
      coordinateOk,
    });
    onPress && onPress(e);
  };

  const nativeId = String(properties?.cluster_id ?? `${lng}_${lat}`);
  return (
    <Marker
      key={keyBase}
      coordinate={{ longitude: lng, latitude: lat }}
      onPress={safeOnPress}
      tracksViewChanges={tvc}
      tappable={true}
      identifier={nativeId}
    >

      <View style={[styles.container, { width, height }]} pointerEvents="none" collapsable={false}>
        <View
          style={[
            styles.wrapper,
            { backgroundColor: clusterColor, width, height, borderRadius: width / 2 },
          ]}
        />
        <View
          style={[
            styles.cluster,
            { backgroundColor: clusterColor, width: size, height: size, borderRadius: size / 2 },
          ]}
        >
          <Text
            style={[
              styles.text,
              { color: clusterTextColor, fontSize, fontFamily: clusterFontFamily },
            ]}
          >
            {points}
          </Text>
        </View>
      </View>
    </Marker>
  );
};

const styles = StyleSheet.create({
  container: { display: 'flex', justifyContent: 'center', alignItems: 'center' },
  wrapper: { position: 'absolute', opacity: 0.5 },
  cluster: { display: 'flex', justifyContent: 'center', alignItems: 'center' },
  text: { fontWeight: 'bold' },
});

export default memo(ClusteredMarker);
