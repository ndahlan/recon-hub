import 'react-native-url-polyfill/auto';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState as RNAppState, AppStateStatus, Linking, Text, TouchableOpacity, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { Session } from '@supabase/supabase-js';
import { hubSupabase } from './src/lib/hubSupabase';
import { useNetworkSync } from './src/hooks/useNetworkSync';

// Auth screens
import LandingScreen from './src/screens/LandingScreen';
import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';
import SetNewPasswordScreen from './src/screens/SetNewPasswordScreen';

// App screens
import HomeScreen from './src/screens/HomeScreen';
import CreateProjectScreen from './src/screens/CreateProjectScreen';
import GalleryScreen from './src/screens/GalleryScreen';
import AddEntryScreen from './src/screens/AddEntryScreen';
import ViewEntryScreen from './src/screens/ViewEntryScreen';
import EditEntryScreen from './src/screens/EditEntryScreen';
import ProjectSettingsScreen from './src/screens/ProjectSettingsScreen';
import ProjectCommentsScreen from './src/screens/ProjectCommentsScreen';
import CropScreen from './src/screens/CropScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import ExportScreen from './src/screens/ExportScreen';

import { AuthStackParamList, AppStackParamList } from './src/types';

const AuthStack = createStackNavigator<AuthStackParamList>();
const AppStack = createStackNavigator<AppStackParamList>();

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Landing" component={LandingScreen} />
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
      <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    </AuthStack.Navigator>
  );
}

function AppNavigator() {
  return (
    <AppStack.Navigator screenOptions={{
      headerStyle: { backgroundColor: '#1a3a2a' },
      headerTintColor: '#fff',
      headerTitleStyle: { fontWeight: '700' },
    }}>
      <AppStack.Screen name="Home" component={HomeScreen}
        options={({ navigation: nav }) => ({
          title: 'Recon',
          headerRight: () => (
            <TouchableOpacity
              onPress={() => (nav as any).navigate('Profile')}
              style={{ marginRight: 14 }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <View style={{
                width: 36, height: 36, borderRadius: 18,
                backgroundColor: '#fff',
                alignItems: 'center', justifyContent: 'center',
                shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
                elevation: 3,
              }}>
                <Text style={{ fontSize: 20 }}>👤</Text>
              </View>
            </TouchableOpacity>
          ),
        })} />
      <AppStack.Screen name="CreateProject" component={CreateProjectScreen} options={{ title: 'New Project' }} />
      <AppStack.Screen name="Gallery" component={GalleryScreen}
        options={({ route }) => {
          const fullName: string = (route.params as any)?.project?.name ?? 'Gallery';
          const words = fullName.split(' ');
          const isTruncated = words.length >= 4;
          const shortName = isTruncated ? words.slice(0, 3).join(' ') + '…' : fullName;
          return ({
            headerTitle: () => (
              <TouchableOpacity
                onPress={() => isTruncated && Alert.alert('Project', fullName)}
                activeOpacity={isTruncated ? 0.6 : 1}
                style={{ flexDirection: 'row', alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }} numberOfLines={1}>
                  {shortName}
                </Text>
                {isTruncated && (
                  <Text style={{ color: '#74c69d', fontSize: 12, marginLeft: 4 }}>ⓘ</Text>
                )}
              </TouchableOpacity>
            ),
            // headerRight is injected by GalleryScreen via useLayoutEffect (includes unread badge)
          });
        }} />
      <AppStack.Screen name="AddEntry" component={AddEntryScreen} options={{ title: 'New Entry' }} />
      <AppStack.Screen name="Crop" component={CropScreen} options={{ title: 'Crop Photo' }} />
      <AppStack.Screen name="ViewEntry" component={ViewEntryScreen}
        options={({ route }) => ({ title: (route.params as any)?.entry?.category ?? 'Entry' })} />
      <AppStack.Screen name="EditEntry" component={EditEntryScreen} options={{ title: 'Edit Entry' }} />
      <AppStack.Screen name="ProjectSettings" component={ProjectSettingsScreen}
        options={({ route }) => ({ title: (route.params as any)?.project?.name ?? 'Settings' })} />
      <AppStack.Screen name="ProjectComments" component={ProjectCommentsScreen}
        options={{ title: 'Discussion' }} />
      <AppStack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
      <AppStack.Screen name="Export" component={ExportScreen} options={{ title: 'Export Data' }} />
    </AppStack.Navigator>
  );
}

type ScreenState = 'loading' | 'unauthenticated' | 'ready' | 'password_recovery';

export default function App() {
  const [screenState, setScreenState] = useState<ScreenState>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);

  // Sync any offline-created entries whenever internet returns
  useNetworkSync();

  const syncSession = async () => {
    try {
      const { data: { session: s } } = await hubSupabase.auth.getSession();
      if (s?.user?.id !== sessionRef.current?.user?.id) {
        sessionRef.current = s;
        setSession(s);
      }
    } catch { }
  };

  // Handle recon:// deep links (password recovery + email confirmation)
  const handleDeepLink = useCallback(async (url: string) => {
    if (!url) return;
    const fragment = url.includes('#') ? url.split('#')[1] : url.split('?')[1] ?? '';
    const params = new URLSearchParams(fragment);
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token') ?? '';
    const type = params.get('type') ?? '';

    if (!access_token) return;

    if (type === 'recovery' || url.includes('reset-password') || url.includes('type=recovery')) {
      // Password reset — setSession fires SIGNED_IN (not PASSWORD_RECOVERY), so we
      // must force the correct screen state ourselves AFTER the session is set.
      await hubSupabase.auth.setSession({ access_token, refresh_token });
      setScreenState('password_recovery');
    } else if (type === 'signup' || type === 'email' || url.includes('type=signup')) {
      // Email confirmation — set the session so the user is logged in right away.
      // onAuthStateChange fires SIGNED_IN → setScreenState('ready')
      await hubSupabase.auth.setSession({ access_token, refresh_token });
    }
  }, []);

  useEffect(() => {
    const stallGuard = setTimeout(() => setScreenState('unauthenticated'), 8000);

    const { data: { subscription } } = hubSupabase.auth.onAuthStateChange((event, s) => {
      sessionRef.current = s;
      setSession(s);
      if (event === 'INITIAL_SESSION') {
        clearTimeout(stallGuard);
        setScreenState(s ? 'ready' : 'unauthenticated');
      } else if (event === 'SIGNED_IN') {
        setScreenState('ready');
      } else if (event === 'PASSWORD_RECOVERY') {
        setScreenState('password_recovery');
      } else if (event === 'SIGNED_OUT') {
        setScreenState('unauthenticated');
      }
    });

    const appStateSub = RNAppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') syncSession();
    });

    const linkingSub = Linking.addEventListener('url', ({ url }) => handleDeepLink(url));
    Linking.getInitialURL().then((url) => { if (url) handleDeepLink(url); });

    return () => {
      subscription.unsubscribe();
      appStateSub.remove();
      linkingSub.remove();
      clearTimeout(stallGuard);
    };
  }, [handleDeepLink]);

  if (screenState === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: '#F5F7FA', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#1a3a2a" />
      </View>
    );
  }

  if (screenState === 'password_recovery') {
    return (
      <SetNewPasswordScreen onPasswordSet={() => setScreenState('unauthenticated')} />
    );
  }

  return (
    <NavigationContainer>
      {screenState === 'ready'
        ? <AppNavigator key={session?.user.id} />
        : <AuthNavigator key="auth" />}
    </NavigationContainer>
  );
}
