// ─── Supabase config stored per-user ──────────────────────────────────────────
export interface UserSupabaseConfig {
  url: string;
  anonKey: string;
  serviceKey?: string; // only stored server-side in hub, never in app
}

// ─── Domain types ──────────────────────────────────────────────────────────────
export interface Project {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  owner_email?: string;   // creator's email — included so invitees can see the owner in @mention lists
  created_at: string;
  updated_at: string;
  is_owner?: boolean;
  is_admin?: boolean;   // true when current user is an admin member of this project
  // For shared projects — points to the owner's Supabase config
  supabase_url?: string;
  supabase_anon_key?: string;
}

export interface FieldEntry {
  id: string;
  project_id: string;
  user_id: string;
  uploaded_by?: string;       // display name of the user who uploaded
  local_uri?: string;         // path on device (before/during upload)
  photo_url: string;          // storage filename / signed URL after upload
  media_type: 'photo' | 'video';
  upload_status: UploadStatus;
  description: string;
  category: string;
  country: string;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  archived_at?: string;
  created_at: string;
  is_local_only?: boolean;  // true when created offline, not yet synced to Supabase
}

export type UploadStatus = 'pending' | 'uploading' | 'uploaded' | 'failed';

export interface UploadQueueItem {
  id: string;               // uuid
  entry_id: string;
  project_id: string;
  local_uri: string;
  media_type: 'photo' | 'video';
  filename: string;
  status: UploadStatus;
  attempts: number;
  error?: string;
  created_at: string;
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id?: string;
  invited_email: string;
  role: 'editor' | 'viewer';
  is_admin: boolean;
  accepted: boolean;
  invited_at: string;
  // Supabase config for accessing the owner's data
  supabase_url?: string;
  supabase_anon_key?: string;
}

export interface UserProfile {
  id?: string;
  name: string;
  phone: string;
  email?: string;
  supabase_provisioned?: boolean;
}

export interface EntryComment {
  id: string;
  entry_id: string;
  project_id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  comment: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectComment {
  id: string;
  project_id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  comment: string;
  mentions: string[];
  created_at: string;
  updated_at: string;
}

// ─── Navigation ────────────────────────────────────────────────────────────────
export type AuthStackParamList = {
  Landing: undefined;
  Login: undefined;
  Register: undefined;
  Provisioning: { userId: string; email: string };
  ForgotPassword: undefined;
  SetNewPassword: undefined;
};

export type AppStackParamList = {
  Home: undefined;
  CreateProject: undefined;
  ProjectSettings: { project: Project };
  ProjectComments: { project: Project };
  Gallery: { project: Project };
  AddEntry: { project: Project };
  Crop: { uri: string; project: Project };
  ViewEntry: { entry: FieldEntry; project: Project };
  EditEntry: { entry: FieldEntry; project: Project };
  Profile: undefined;
  Export: undefined;
};

// ─── Categories ────────────────────────────────────────────────────────────────
export const CATEGORIES = [
  'GNSS', 'Volcano', 'Sea Level', 'Coral', 'Biodiversity', 'Climate', 'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];
