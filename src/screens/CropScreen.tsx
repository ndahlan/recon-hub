/**
 * CropScreen — interactive crop for an already-selected photo.
 *
 * Gesture design:
 *   • Four corner handles (48 pt tap targets, bright L-brackets + shadow)
 *   • Drag anywhere inside the white frame to reposition the crop box
 *   • Uses translationX/Y + onStart snapshot to avoid the "jump" bug
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { AppStackParamList } from '../types';
import { consumeCropCallback } from '../utils/cropCallback';

type Route = RouteProp<AppStackParamList, 'Crop'>;
type Nav   = StackNavigationProp<AppStackParamList, 'Crop'>;

// ─── Constants ──────────────────────────────────────────────────────────────
const MIN_DIM = 60;   // minimum crop box size (px)
const HH      = 52;   // handle tap-target size
const HALF    = HH / 2;
const ARM     = 26;   // visible L-bracket arm length
const THK     = 6;    // L-bracket arm thickness

// Module-level worklet so Reanimated's babel transform sees it correctly
function clamp(v: number, lo: number, hi: number) {
  'worklet';
  return Math.max(lo, Math.min(hi, v));
}

// ─── Component ──────────────────────────────────────────────────────────────
export default function CropScreen() {
  const { params }  = useRoute<Route>();
  const navigation  = useNavigation<Nav>();
  const { uri } = params;

  const [ready,    setReady]    = useState(false);
  const [cropping, setCropping] = useState(false);

  const naturalRef = useRef({ w: 1, h: 1 });
  const canvasRef  = useRef({ w: 0, h: 0 });

  // ── Shared values: display rect (image letterbox inside canvas) ────────────
  const dispX = useSharedValue(0);
  const dispY = useSharedValue(0);
  const dispW = useSharedValue(1);
  const dispH = useSharedValue(1);

  // ── Shared values: crop box corners (screen coords) ────────────────────────
  const x1 = useSharedValue(0);
  const y1 = useSharedValue(0);
  const x2 = useSharedValue(1);
  const y2 = useSharedValue(1);

  // ── Per-gesture start snapshots (prevent jump by using translationX/Y) ────
  // Each gesture captures position at onStart so translation can be added cleanly
  const tlSx = useSharedValue(0); const tlSy = useSharedValue(0); // TL → x1, y1
  const trSx = useSharedValue(0); const trSy = useSharedValue(0); // TR → x2, y1
  const blSx = useSharedValue(0); const blSy = useSharedValue(0); // BL → x1, y2
  const brSx = useSharedValue(0); const brSy = useSharedValue(0); // BR → x2, y2
  const bdSx = useSharedValue(0); const bdSy = useSharedValue(0); // body → x1, y1
  const bdW  = useSharedValue(0); const bdH  = useSharedValue(0); // body width/height at start

  // ── Compute display rect ──────────────────────────────────────────────────
  const computeRect = useCallback(() => {
    const { w: nw, h: nh } = naturalRef.current;
    const { w: cw, h: ch } = canvasRef.current;
    if (nw < 1 || nh < 1 || cw < 1 || ch < 1) return;
    const scale = Math.min(cw / nw, ch / nh);
    const dw = nw * scale, dh = nh * scale;
    const dx = (cw - dw) / 2, dy = (ch - dh) / 2;
    dispX.value = dx; dispY.value = dy;
    dispW.value = dw; dispH.value = dh;
    // Initialise crop box to full image area
    x1.value = dx; y1.value = dy;
    x2.value = dx + dw; y2.value = dy + dh;
    setReady(true);
  }, [dispX, dispY, dispW, dispH, x1, y1, x2, y2]);

  useEffect(() => {
    Image.getSize(
      uri,
      (w, h) => { naturalRef.current = { w, h }; computeRect(); },
      () => setReady(true),
    );
  }, [uri, computeRect]);

  const onCanvasLayout = useCallback((e: any) => {
    const { width, height } = e.nativeEvent.layout;
    canvasRef.current = { w: width, h: height };
    if (naturalRef.current.w > 1) computeRect();
  }, [computeRect]);

  // ── Dim overlays outside crop box ─────────────────────────────────────────
  const topSt    = useAnimatedStyle(() => ({ position: 'absolute', left: 0, right: 0, top: 0, height: y1.value, backgroundColor: 'rgba(0,0,0,0.65)' }));
  const bottomSt = useAnimatedStyle(() => ({ position: 'absolute', left: 0, right: 0, top: y2.value, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)' }));
  const leftSt   = useAnimatedStyle(() => ({ position: 'absolute', left: 0, width: x1.value, top: y1.value, height: y2.value - y1.value, backgroundColor: 'rgba(0,0,0,0.65)' }));
  const rightSt  = useAnimatedStyle(() => ({ position: 'absolute', left: x2.value, right: 0, top: y1.value, height: y2.value - y1.value, backgroundColor: 'rgba(0,0,0,0.65)' }));

  // Crop box border
  const boxSt = useAnimatedStyle(() => ({
    position: 'absolute',
    left: x1.value, top: y1.value,
    width: x2.value - x1.value, height: y2.value - y1.value,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.85)',
  }));

  // Corner handle positions
  const tlSt = useAnimatedStyle(() => ({ position: 'absolute', left: x1.value - HALF, top: y1.value - HALF, width: HH, height: HH }));
  const trSt = useAnimatedStyle(() => ({ position: 'absolute', left: x2.value - HALF, top: y1.value - HALF, width: HH, height: HH }));
  const blSt = useAnimatedStyle(() => ({ position: 'absolute', left: x1.value - HALF, top: y2.value - HALF, width: HH, height: HH }));
  const brSt = useAnimatedStyle(() => ({ position: 'absolute', left: x2.value - HALF, top: y2.value - HALF, width: HH, height: HH }));

  // ── Gestures ──────────────────────────────────────────────────────────────
  // Body: drag inside the frame to move the whole crop box
  const bodyGesture = Gesture.Pan()
    .onStart(() => {
      'worklet';
      bdSx.value = x1.value; bdSy.value = y1.value;
      bdW.value  = x2.value - x1.value;
      bdH.value  = y2.value - y1.value;
    })
    .onUpdate((e) => {
      'worklet';
      const nx = clamp(bdSx.value + e.translationX, dispX.value, dispX.value + dispW.value - bdW.value);
      const ny = clamp(bdSy.value + e.translationY, dispY.value, dispY.value + dispH.value - bdH.value);
      x1.value = nx;          y1.value = ny;
      x2.value = nx + bdW.value; y2.value = ny + bdH.value;
    });

  // TL corner: moves x1 and y1
  const tlGesture = Gesture.Pan()
    .onStart(() => { 'worklet'; tlSx.value = x1.value; tlSy.value = y1.value; })
    .onUpdate((e) => {
      'worklet';
      x1.value = clamp(tlSx.value + e.translationX, dispX.value,         x2.value - MIN_DIM);
      y1.value = clamp(tlSy.value + e.translationY, dispY.value,         y2.value - MIN_DIM);
    });

  // TR corner: moves x2 and y1
  const trGesture = Gesture.Pan()
    .onStart(() => { 'worklet'; trSx.value = x2.value; trSy.value = y1.value; })
    .onUpdate((e) => {
      'worklet';
      x2.value = clamp(trSx.value + e.translationX, x1.value + MIN_DIM, dispX.value + dispW.value);
      y1.value = clamp(trSy.value + e.translationY, dispY.value,         y2.value - MIN_DIM);
    });

  // BL corner: moves x1 and y2
  const blGesture = Gesture.Pan()
    .onStart(() => { 'worklet'; blSx.value = x1.value; blSy.value = y2.value; })
    .onUpdate((e) => {
      'worklet';
      x1.value = clamp(blSx.value + e.translationX, dispX.value,         x2.value - MIN_DIM);
      y2.value = clamp(blSy.value + e.translationY, y1.value + MIN_DIM, dispY.value + dispH.value);
    });

  // BR corner: moves x2 and y2
  const brGesture = Gesture.Pan()
    .onStart(() => { 'worklet'; brSx.value = x2.value; brSy.value = y2.value; })
    .onUpdate((e) => {
      'worklet';
      x2.value = clamp(brSx.value + e.translationX, x1.value + MIN_DIM, dispX.value + dispW.value);
      y2.value = clamp(brSy.value + e.translationY, y1.value + MIN_DIM, dispY.value + dispH.value);
    });

  // ── Apply crop ───────────────────────────────────────────────────────────
  const applyCrop = async () => {
    setCropping(true);
    try {
      const { w: nw, h: nh } = naturalRef.current;
      const scaleX = nw / dispW.value;
      const scaleY = nh / dispH.value;
      const cropX = Math.max(0, Math.round((x1.value - dispX.value) * scaleX));
      const cropY = Math.max(0, Math.round((y1.value - dispY.value) * scaleY));
      const cropW = Math.min(nw - cropX, Math.round((x2.value - x1.value) * scaleX));
      const cropH = Math.min(nh - cropY, Math.round((y2.value - y1.value) * scaleY));
      const result = await manipulateAsync(
        uri,
        [{ crop: { originX: cropX, originY: cropY, width: cropW, height: cropH } }],
        { compress: 1.0, format: SaveFormat.JPEG },
      );
      // Deliver the cropped URI to AddEntryScreen via the one-shot callback,
      // then simply pop this screen — no extra stack entries, no loop.
      consumeCropCallback(result.uri);
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Crop failed', e.message ?? 'Unknown error');
    } finally {
      setCropping(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>

      {/* ── Image canvas ─────────────────────────────────────────────── */}
      <View style={styles.canvas} onLayout={onCanvasLayout}>
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />

        {ready ? (
          <>
            {/* Dim areas */}
            <Animated.View style={topSt}    pointerEvents="none" />
            <Animated.View style={bottomSt} pointerEvents="none" />
            <Animated.View style={leftSt}   pointerEvents="none" />
            <Animated.View style={rightSt}  pointerEvents="none" />

            {/* Crop box — drag body to move */}
            <GestureDetector gesture={bodyGesture}>
              <Animated.View style={boxSt}>
                {/* Rule-of-thirds grid (non-interactive) */}
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                  <View style={styles.gV1} /><View style={styles.gV2} />
                  <View style={styles.gH1} /><View style={styles.gH2} />
                </View>
              </Animated.View>
            </GestureDetector>

            {/* ── Corner handles ─────────────────────────────────────────
                Rendered AFTER the box so they sit on a higher z-layer
                and always capture touch before the body gesture does.   */}

            {/* Top-Left */}
            <GestureDetector gesture={tlGesture}>
              <Animated.View style={tlSt}>
                <View style={styles.hWrap}>
                  <View style={[styles.arm, styles.tlH]} />
                  <View style={[styles.arm, styles.tlV]} />
                </View>
              </Animated.View>
            </GestureDetector>

            {/* Top-Right */}
            <GestureDetector gesture={trGesture}>
              <Animated.View style={trSt}>
                <View style={styles.hWrap}>
                  <View style={[styles.arm, styles.trH]} />
                  <View style={[styles.arm, styles.trV]} />
                </View>
              </Animated.View>
            </GestureDetector>

            {/* Bottom-Left */}
            <GestureDetector gesture={blGesture}>
              <Animated.View style={blSt}>
                <View style={styles.hWrap}>
                  <View style={[styles.arm, styles.blH]} />
                  <View style={[styles.arm, styles.blV]} />
                </View>
              </Animated.View>
            </GestureDetector>

            {/* Bottom-Right */}
            <GestureDetector gesture={brGesture}>
              <Animated.View style={brSt}>
                <View style={styles.hWrap}>
                  <View style={[styles.arm, styles.brH]} />
                  <View style={[styles.arm, styles.brV]} />
                </View>
              </Animated.View>
            </GestureDetector>
          </>
        ) : (
          <ActivityIndicator color="#fff" size="large" style={StyleSheet.absoluteFill} />
        )}
      </View>

      {/* ── Bottom toolbar ────────────────────────────────────────────── */}
      <View style={styles.toolbar}>
        <Text style={styles.hint}>
          Drag <Text style={styles.hintBold}>corner brackets</Text> to resize  ·  drag <Text style={styles.hintBold}>inside</Text> the frame to move
        </Text>
        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => navigation.goBack()} disabled={cropping}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.applyBtn, cropping && styles.applyBtnOff]}
            onPress={applyCrop}
            disabled={cropping}
          >
            {cropping
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.applyText}>✓  Apply Crop</Text>}
          </TouchableOpacity>
        </View>
      </View>

    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────
// L-bracket corners:
//   Each handle is an HH×HH transparent tap target centred on the crop corner.
//   Inside, two white rectangles form the L shape. The inner corner of the L
//   is at (HALF, HALF) — the centre of the handle = the crop box corner.
//   One arm extends outward horizontally, one arm extends outward vertically.
//   Both arms have THK thickness and ARM length.

const ARM_OFFSET = HALF - THK / 2; // inner edge of the arm, centred on HALF

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  canvas:    { flex: 1 },

  // Toolbar
  toolbar:   { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 28, backgroundColor: '#111' },
  hint:      { fontSize: 12, color: '#888', textAlign: 'center', marginBottom: 10 },
  hintBold:  { color: '#ccc', fontWeight: '700' },
  btnRow:    { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, backgroundColor: '#2a2a2a', borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  cancelText: { color: '#ccc', fontWeight: '600', fontSize: 15 },
  applyBtn:  { flex: 2, backgroundColor: '#16A34A', borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  applyBtnOff: { backgroundColor: '#4B8B6A' },
  applyText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // Grid
  gV1: { position: 'absolute', left: '33.33%', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.25)' },
  gV2: { position: 'absolute', left: '66.67%', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.25)' },
  gH1: { position: 'absolute', top: '33.33%', left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.25)' },
  gH2: { position: 'absolute', top: '66.67%', left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.25)' },

  // Handle wrapper fills the tap target
  hWrap: { width: HH, height: HH },

  // Shared arm style
  arm: {
    position: 'absolute',
    backgroundColor: '#FFE600',   // bright yellow — visible on any photo
    // Drop shadow for contrast on both light and dark photos
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.7,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },

  // ── TL ⌜ (arms extend LEFT and UP from centre)
  tlH: { left: 0,          top: ARM_OFFSET,  width: ARM, height: THK },   // horizontal arm → left
  tlV: { left: ARM_OFFSET, top: 0,           width: THK, height: ARM },   // vertical arm → up

  // ── TR ⌝ (arms extend RIGHT and UP from centre)
  trH: { right: 0,         top: ARM_OFFSET,  width: ARM, height: THK },
  trV: { left: ARM_OFFSET, top: 0,           width: THK, height: ARM },

  // ── BL ⌞ (arms extend LEFT and DOWN from centre)
  blH: { left: 0,          top: ARM_OFFSET,  width: ARM, height: THK },
  blV: { left: ARM_OFFSET, bottom: 0,        width: THK, height: ARM },

  // ── BR ⌟ (arms extend RIGHT and DOWN from centre)
  brH: { right: 0,         top: ARM_OFFSET,  width: ARM, height: THK },
  brV: { left: ARM_OFFSET, bottom: 0,        width: THK, height: ARM },
});
