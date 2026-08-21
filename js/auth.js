// js/auth.js
import { supabase, isConfigured } from './supabase-client.js';
import { initNotifications } from './notifications.js';
let currentUser = null;
let currentSession = null;

export function getCurrentUser() { return currentUser; }
export function getCurrentSession() { return currentSession; }

function $(id) { return document.getElementById(id); }

function toast(message, type='') {
  const root = $('toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type}`.trim();
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
window.appToast = toast;

function setAuthUI(user) {
  $('auth-screen').classList.toggle('hidden', !!user);
  $('app').classList.toggle('hidden', !user);
}

async function syncProfile(user) {
  const metadata = user.user_metadata || {};
  const fullName = metadata.full_name || metadata.name || user.email?.split('@')[0] || 'User';
  const googleAvatar = metadata.avatar_url || metadata.picture || null;

  // Kiểm tra profile hiện tại
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('avatar_url, full_name')
    .eq('id', user.id)
    .single();

  // Chỉ lấy avatar Google nếu trong DB chưa có avatar nào
  const avatarUrl = existingProfile?.avatar_url || googleAvatar;

  const { error } = await supabase.from('profiles').upsert({
    id: user.id,
    email: user.email || null,
    full_name: existingProfile?.full_name || fullName,
    avatar_url: avatarUrl
  }, { onConflict: 'id' });

  if (error) console.warn('Profile sync:', error.message);
}

async function loginGoogle() {
  if (!isConfigured()) {
    toast('Hãy cấu hình SUPABASE_URL và SUPABASE_ANON_KEY trong js/supabase-client.js.', 'error');
    return;
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
  if (error) toast(error.message, 'error');
}

async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) toast(error.message, 'error');
}

async function bootstrap() {
  if (!isConfigured()) {
    setAuthUI(false);
    toast('Chưa cấu hình Supabase. Mở js/supabase-client.js để nhập URL/key.', 'error');
    return;
  }

  const { data: { session } } = await supabase.auth.getSession();
  currentSession = session;
  currentUser = session?.user || null;
  setAuthUI(currentUser);

  if (currentUser) {
    await syncProfile(currentUser);
    window.dispatchEvent(new CustomEvent('auth-ready', { detail: { user: currentUser, session } }));
  }

  supabase.auth.onAuthStateChange(async (event, session) => {
    currentSession = session;
    currentUser = session?.user || null;
    setAuthUI(currentUser);

    if (currentUser) {
      await syncProfile(currentUser);
      window.dispatchEvent(new CustomEvent('auth-ready', { detail: { user: currentUser, session, event } }));
    } else {
      window.dispatchEvent(new CustomEvent('auth-signed-out'));
    }
    window.addEventListener('auth-ready', () => {
  initNotifications();
});
  });
}

export function initAuth() {
  $('google-login').addEventListener('click', loginGoogle);
  $('logout-btn').addEventListener('click', logout);
  bootstrap();
}

window.addEventListener('app-modules-ready', () => {
  initAuth();
  window.appModules.initProfile();
  window.appModules.initFeed();
  window.appModules.initChat();
});
