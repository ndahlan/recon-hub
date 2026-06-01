import React, { useState } from 'react';
import {
  Alert, ActivityIndicator, Image, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { updateEntry } from '../db/database';
import { CATEGORIES, AppStackParamList } from '../types';

type Route = RouteProp<AppStackParamList, 'EditEntry'>;
type Nav = StackNavigationProp<AppStackParamList, 'EditEntry'>;
const MAX_CHARS = 500;

export default function EditEntryScreen() {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { entry, project } = params;

  const [description, setDescription] = useState(entry.description);
  const [category, setCategory] = useState(entry.category || 'Other');
  const [country, setCountry] = useState(entry.country || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateEntry(entry.id, description.trim(), category, country.trim());
      navigation.navigate('Gallery', { project });
    } catch {
      Alert.alert('Error', 'Could not save changes.');
    } finally { setSaving(false); }
  };

  const charsLeft = MAX_CHARS - description.length;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={88}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {entry.media_type === 'video' ? (
          <View style={styles.videoPreview}><Text style={styles.videoIcon}>▶</Text><Text style={styles.videoText}>Video entry</Text></View>
        ) : (
          <Image source={{ uri: entry.photo_url }} style={styles.preview} resizeMode="contain" />
        )}

        {entry.latitude != null && (
          <View style={styles.gpsRow}>
            <Text>📍</Text>
            <Text style={styles.gpsText}>{entry.latitude.toFixed(6)}, {entry.longitude?.toFixed(6)}</Text>
          </View>
        )}

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
          <TextInput style={[styles.input, styles.multiline]} placeholder="Write a short description…"
            placeholderTextColor="#aaa" multiline maxLength={MAX_CHARS} value={description}
            onChangeText={setDescription} textAlignVertical="top" autoFocus />
          <Text style={[styles.counter, charsLeft < 50 && styles.counterWarn]}>{charsLeft} characters remaining</Text>
        </View>

        <TouchableOpacity style={[styles.saveBtn, saving && styles.saveBtnDisabled]} onPress={save} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  content: { padding: 16, paddingBottom: 40 },
  preview: { width: '100%', minHeight: 160, maxHeight: 360, borderRadius: 12, marginBottom: 14, backgroundColor: '#ddd' },
  videoPreview: { height: 120, borderRadius: 12, backgroundColor: '#1a3a2a', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  videoIcon: { fontSize: 36, color: '#fff' },
  videoText: { color: '#95d5b2', marginTop: 6, fontSize: 13 },
  gpsRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EFF6FF', borderRadius: 10, padding: 10, marginBottom: 14, gap: 8 },
  gpsText: { fontSize: 12, color: '#1e40af' },
  fieldWrapper: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 6 },
  pickerWrapper: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden' },
  picker: { height: 50, color: '#222' },
  input: { backgroundColor: '#fff', borderRadius: 10, padding: 12, fontSize: 15, color: '#222', borderWidth: 1, borderColor: '#E2E8F0' },
  multiline: { minHeight: 120, textAlignVertical: 'top' },
  counter: { textAlign: 'right', marginTop: 4, fontSize: 12, color: '#999' },
  counterWarn: { color: '#EF4444' },
  saveBtn: { backgroundColor: '#1a3a2a', borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  saveBtnDisabled: { backgroundColor: '#6B9E8A' },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
