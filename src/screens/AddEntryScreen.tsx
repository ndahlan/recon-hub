import React, { useEffect, useRef, useState } from 'react';
import {
  Alert, Image, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as Location from 'expo-location';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { insertEntry } from '../db/database';
import { CATEGORIES, AppStackParamList } from '../types';
import { setCropCallback } from '../utils/cropCallback';

type Route = RouteProp<AppStackParamList, 'AddEntry'>;
type Nav   = StackNavigationProp<AppStackParamList, 'AddEntry'>;
const MAX_CHARS = 500;

export default function AddEntryScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const { project } = params;
  const scrollRef = useRef<ScrollView>(null);

  const [mediaUri, setMediaUri] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'photo' | 'video'>('photo');
  const [assetId, setAssetId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Other');
  const [country, setCountry] = useState('');
  const [gps, setGps] = useState<{ lat: number; lon: number; alt?: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { captureGPS(); }, []);

  const captureGPS = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setGps({ lat: loc.coords.latitude, lon: loc.coords.longitude, alt: loc.coords.altitude ?? undefined });
    } catch { }
    finally { setLocating(false); }
  };

  const pickMedia = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Allow photo library access.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 1.0,
      videoMaxDuration: 60,
      // allowsEditing: true enables the native OS crop tool for photos.
      // We detect photos vs videos after selection; for videos we skip editing.
      allowsEditing: false, // overridden per-type below via separate pickers
    });
    if (!result.canceled) {
      const asset = result.assets[0];
      setMediaUri(asset.uri);
      setMediaType(asset.type === 'video' ? 'video' : 'photo');
      setAssetId(asset.assetId ?? null);
    }
  };

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Allow photo library access.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1.0,
      allowsEditing: false, // no forced crop — user can tap ✂️ Crop in preview if desired
    });
    if (!result.canceled) {
      setMediaUri(result.assets[0].uri);
      setMediaType('photo');
      setAssetId(result.assets[0].assetId ?? null);
    }
  };

  const pickVideo = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Allow photo library access.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      quality: 1.0,
      videoMaxDuration: 60,
    });
    if (!result.canceled) {
      setMediaUri(result.assets[0].uri);
      setMediaType('video');
      setAssetId(result.assets[0].assetId ?? null);
    }
  };

  // Open the interactive crop screen with the currently selected photo.
  // Register a one-shot callback so CropScreen can hand the result back via
  // goBack() — no extra stack entries, no param loop.
  const recropPhoto = () => {
    if (!mediaUri || mediaType !== 'photo') return;
    setCropCallback((croppedUri) => setMediaUri(croppedUri));
    navigation.navigate('Crop', { uri: mediaUri, project });
  };

  const takeMedia = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Allow camera access.'); return; }
    Alert.alert('Capture', 'What would you like to capture?', [
      { text: 'Photo', onPress: takePhoto },
      { text: 'Video', onPress: takeVideo },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const takePhoto = async () => {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1.0,
      allowsEditing: false, // go straight to entry — user can crop via ✂️ Crop button
    });
    if (!result.canceled) {
      setMediaUri(result.assets[0].uri);
      setMediaType('photo');
      setAssetId(result.assets[0].assetId ?? null);
    }
  };

  const takeVideo = async () => {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['videos'],
      quality: 1.0,
      videoMaxDuration: 60,
    });
    if (!result.canceled) {
      setMediaUri(result.assets[0].uri);
      setMediaType('video');
      setAssetId(result.assets[0].assetId ?? null);
    }
  };

  const offerFreeSpace = (id: string | null, uri: string) => {
    Alert.alert(
      '✅ Saved to Cloud',
      'Photo/video safely stored.\n\nDelete original from phone to free space?',
      [
        { text: 'Delete from Phone', style: 'destructive', onPress: () => deleteLocal(id, uri) },
        { text: 'Keep on Phone', style: 'cancel' },
      ]
    );
  };

  const deleteLocal = async (id: string | null, uri: string) => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') return;
      if (id) {
        const asset = await MediaLibrary.getAssetInfoAsync(id);
        await MediaLibrary.deleteAssetsAsync([asset]);
      } else {
        const asset = await MediaLibrary.createAssetAsync(uri);
        await MediaLibrary.deleteAssetsAsync([asset]);
      }
    } catch { }
  };

  const save = async () => {
    if (!mediaUri) { Alert.alert('No media', 'Please add a photo or video.'); return; }
    setSaving(true);
    try {
      await insertEntry(project.id, mediaUri, mediaType, description.trim(), category, country.trim(), gps?.lat, gps?.lon, gps?.alt);
      const savedUri = mediaUri;
      const savedId = assetId;
      navigation.goBack();
      setTimeout(() => offerFreeSpace(savedId, savedUri), 600);
    } catch (e: any) {
      const detail = e?.message ?? String(e) ?? 'Unknown error';
      Alert.alert('Upload failed', detail);
    } finally {
      setSaving(false);
    }
  };

  const charsLeft = MAX_CHARS - description.length;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={88}>
      <ScrollView ref={scrollRef} style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        <View style={styles.projectRow}>
          <Text style={styles.projectIcon}>🗂️</Text>
          <Text style={styles.projectName}>{project.name}</Text>
        </View>

        {mediaUri ? (
          <View>
            {mediaType === 'video' ? (
              <View style={styles.videoPreview}>
                <Text style={styles.videoPreviewIcon}>▶</Text>
                <Text style={styles.videoPreviewText}>Video selected</Text>
              </View>
            ) : (
              <Image source={{ uri: mediaUri }} style={styles.preview} resizeMode="contain" />
            )}
            <View style={styles.mediaActions}>
              <TouchableOpacity style={styles.changeBtn} onPress={() => { setMediaUri(null); setAssetId(null); }}>
                <Text style={styles.changeBtnText}>✕ Change</Text>
              </TouchableOpacity>
              {mediaType === 'photo' && (
                <TouchableOpacity style={styles.cropBtn} onPress={recropPhoto}>
                  <Text style={styles.cropBtnText}>✂️ Crop</Text>
                </TouchableOpacity>
              )}
              {mediaType === 'photo' && (
                <TouchableOpacity
                  style={styles.okBtn}
                  onPress={() => scrollRef.current?.scrollTo({ y: 400, animated: true })}
                >
                  <Text style={styles.okBtnText}>✓ OK</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ) : (
          <View>
            <View style={styles.photoButtons}>
              <TouchableOpacity style={[styles.photoBtn, styles.cameraBtn]} onPress={takeMedia}>
                <Text style={styles.photoBtnIcon}>📷</Text>
                <Text style={styles.photoBtnText}>Camera</Text>
                <Text style={styles.photoBtnSub}>Photo or Video</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.libraryButtons}>
              <TouchableOpacity style={[styles.photoBtn, styles.libraryBtn]} onPress={pickPhoto}>
                <Text style={styles.photoBtnIcon}>🖼️</Text>
                <Text style={styles.photoBtnText}>Photo</Text>
                <Text style={styles.photoBtnSub}>From library</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.photoBtn, styles.videoBtn]} onPress={pickVideo}>
                <Text style={styles.photoBtnIcon}>🎬</Text>
                <Text style={styles.photoBtnText}>Video</Text>
                <Text style={styles.photoBtnSub}>Up to 60s</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.gpsRow}>
          <Text style={styles.gpsIcon}>📍</Text>
          {locating ? <ActivityIndicator size="small" color="#2563EB" style={{ marginLeft: 8 }} /> :
            gps ? <Text style={styles.gpsText}>{gps.lat.toFixed(6)}, {gps.lon.toFixed(6)}{gps.alt != null ? `  ▲ ${gps.alt.toFixed(1)} m` : ''}</Text> :
              <TouchableOpacity onPress={captureGPS}><Text style={styles.gpsRetry}>Tap to get GPS</Text></TouchableOpacity>}
        </View>

        <View style={styles.fieldWrapper}>
          <Text style={styles.label}>Category</Text>
          <View style={styles.pickerWrapper}>
            <Picker selectedValue={category} onValueChange={(v) => setCategory(v)} style={styles.picker}>
              {CATEGORIES.map((cat) => <Picker.Item key={cat} label={cat} value={cat} />)}
            </Picker>
          </View>
        </View>

        <View style={styles.fieldWrapper}>
          <Text style={styles.label}>Country</Text>
          <TextInput style={styles.input} placeholder="e.g. Indonesia" placeholderTextColor="#aaa" value={country} onChangeText={setCountry} />
        </View>

        <View style={styles.fieldWrapper}>
          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.multiline]} placeholder="Write a short description…"
            placeholderTextColor="#aaa" multiline maxLength={MAX_CHARS}
            value={description} onChangeText={setDescription} textAlignVertical="top"
          />
          <Text style={[styles.counter, charsLeft < 50 && styles.counterWarn]}>{charsLeft} characters remaining</Text>
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, (!mediaUri || saving) && styles.saveBtnDisabled]}
          onPress={save} disabled={!mediaUri || saving}
        >
          {saving
            ? <><ActivityIndicator color="#fff" style={{ marginRight: 8 }} /><Text style={styles.saveBtnText}>Uploading to cloud…</Text></>
            : <Text style={styles.saveBtnText}>Upload & Save</Text>}
        </TouchableOpacity>
        <Text style={styles.hint}>📡 Full quality · max 60s video</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  content: { padding: 16, paddingBottom: 40 },
  projectRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a3a2a18', borderRadius: 10, padding: 10, marginBottom: 16 },
  projectIcon: { fontSize: 16, marginRight: 8 },
  projectName: { fontSize: 14, fontWeight: '700', color: '#1a3a2a', flex: 1 },
  photoButtons: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  libraryButtons: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  photoBtn: { flex: 1, height: 110, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderStyle: 'dashed' },
  cameraBtn: { borderColor: '#2563EB', backgroundColor: '#EFF6FF' },
  libraryBtn: { borderColor: '#7C3AED', backgroundColor: '#F5F3FF' },
  videoBtn: { borderColor: '#0891B2', backgroundColor: '#ECFEFF' },
  photoBtnIcon: { fontSize: 26, marginBottom: 4 },
  photoBtnText: { fontSize: 13, fontWeight: '600', color: '#444' },
  photoBtnSub: { fontSize: 11, color: '#888', marginTop: 2 },
  preview: { width: '100%', minHeight: 160, maxHeight: 420, borderRadius: 12, marginBottom: 8, backgroundColor: '#ddd' },
  videoPreview: { height: 140, borderRadius: 12, backgroundColor: '#1a3a2a', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  videoPreviewIcon: { fontSize: 40, color: '#fff' },
  videoPreviewText: { color: '#95d5b2', fontSize: 14, marginTop: 8 },
  mediaActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginBottom: 12 },
  changeBtn: { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#F1F5F9' },
  changeBtnText: { color: '#64748B', fontSize: 13, fontWeight: '600' },
  cropBtn: { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#EFF6FF' },
  cropBtnText: { color: '#2563EB', fontSize: 13, fontWeight: '600' },
  okBtn: { paddingVertical: 5, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#DCFCE7' },
  okBtnText: { color: '#16A34A', fontSize: 13, fontWeight: '700' },
  gpsRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 10, marginBottom: 14, borderWidth: 1, borderColor: '#E2E8F0' },
  gpsIcon: { fontSize: 16 },
  gpsText: { fontSize: 12, color: '#555', marginLeft: 8, flex: 1 },
  gpsRetry: { fontSize: 13, color: '#2563EB', marginLeft: 8, fontWeight: '600' },
  fieldWrapper: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 6 },
  pickerWrapper: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden' },
  picker: { height: 50, color: '#222' },
  input: { backgroundColor: '#fff', borderRadius: 10, padding: 12, fontSize: 15, color: '#222', borderWidth: 1, borderColor: '#E2E8F0' },
  multiline: { minHeight: 110, textAlignVertical: 'top' },
  counter: { textAlign: 'right', marginTop: 4, fontSize: 12, color: '#999' },
  counterWarn: { color: '#EF4444' },
  saveBtn: { backgroundColor: '#1a3a2a', borderRadius: 12, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', marginTop: 4 },
  saveBtnDisabled: { backgroundColor: '#6B9E8A' },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  hint: { textAlign: 'center', color: '#94a3b8', fontSize: 12, marginTop: 10 },
});
