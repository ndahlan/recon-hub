import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { UploadStatus } from '../types';

interface Props {
  status: UploadStatus;
  size?: number;
}

export default function UploadStatusBadge({ status, size = 22 }: Props) {
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinLoop = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (status === 'uploading') {
      spinLoop.current = Animated.loop(
        Animated.timing(spinAnim, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        })
      );
      spinLoop.current.start();
    } else {
      spinLoop.current?.stop();
      spinAnim.setValue(0);
    }
  }, [status, spinAnim]);

  const rotate = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const color = {
    pending: '#94a3b8',
    uploading: '#2563EB',
    uploaded: '#16A34A',
    failed: '#DC2626',
  }[status];

  const icon = {
    pending: '☁',
    uploading: '↑',
    uploaded: '✓',
    failed: '✕',
  }[status];

  return (
    <View style={[styles.badge, { backgroundColor: color + '22', borderColor: color, width: size, height: size, borderRadius: size / 2 }]}>
      {status === 'uploading' ? (
        <Animated.Text style={[styles.icon, { color, fontSize: size * 0.55, transform: [{ rotate }] }]}>
          {icon}
        </Animated.Text>
      ) : (
        <Animated.Text style={[styles.icon, { color, fontSize: size * 0.55 }]}>
          {icon}
        </Animated.Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontWeight: '700',
    lineHeight: undefined,
    includeFontPadding: false,
  },
});
