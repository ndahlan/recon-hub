import React, { useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { createProject } from '../db/database';

export default function CreateProjectScreen() {
  const navigation = useNavigation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) { Alert.alert('Error', 'Project name is required.'); return; }
    setSaving(true);
    try {
      await createProject(name.trim(), description.trim());
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not create project.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={88}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.fieldWrapper}>
          <Text style={styles.label}>Project Name <Text style={styles.required}>*</Text></Text>
          <TextInput
            style={styles.input} placeholder="e.g. Indonesia GNSS Survey 2026"
            placeholderTextColor="#aaa" value={name} onChangeText={setName} autoFocus
          />
        </View>
        <View style={styles.fieldWrapper}>
          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            placeholder="Brief description of this project…"
            placeholderTextColor="#aaa" value={description} onChangeText={setDescription}
            multiline textAlignVertical="top"
          />
        </View>
        <TouchableOpacity
          style={[styles.btn, (!name.trim() || saving) && styles.btnDisabled]}
          onPress={save} disabled={!name.trim() || saving}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Create Project</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  content: { padding: 20, paddingBottom: 40 },
  fieldWrapper: { marginBottom: 18 },
  label: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 6 },
  required: { color: '#DC2626' },
  input: { backgroundColor: '#fff', borderRadius: 10, padding: 13, fontSize: 15, color: '#222', borderWidth: 1, borderColor: '#E2E8F0' },
  multiline: { minHeight: 110, textAlignVertical: 'top' },
  btn: { backgroundColor: '#1a3a2a', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  btnDisabled: { backgroundColor: '#6B9E8A' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
