import { supabase } from './supabase-client.js';
import { getCurrentUser } from './auth.js';
import { escapeHtml, openUserProfile } from './profile.js';

const $ = id => document.getElementById(id);

let notifications = [];

export async function initNotifications() {
  const user = getCurrentUser();
  if (!user) return;

  await fetchNotifications();
  setupNotificationRealtime(user.id);

  const notifBtn = $('notification-btn');
  const notifDropdown = $('notification-dropdown');

  if (notifBtn && notifDropdown) {
    notifBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = notifDropdown.style.display === 'none' || notifDropdown.style.display === '';
      notifDropdown.style.display = isHidden ? 'block' : 'none';
      if (isHidden) {
        markNotificationsAsRead();
      }
    });

    // Click ra ngoài thì ẩn dropdown
    document.addEventListener('click', (e) => {
      if (!notifDropdown.contains(e.target) && !notifBtn.contains(e.target)) {
        notifDropdown.style.display = 'none';
      }
    });
  }

  const markAllBtn = $('mark-all-read');
  if (markAllBtn) {
    markAllBtn.addEventListener('click', async () => {
      await markNotificationsAsRead();
    });
  }

  // Lắng nghe sự kiện click vào item thông báo trong danh sách
  const notifList = $('notification-list');
  if (notifList) {
    notifList.addEventListener('click', (e) => {
      const item = e.target.closest('.notification-item');
      if (item) {
        const postId = item.dataset.postId;
        notifDropdown.style.display = 'none';
        if (postId) {
          // Cuộn đến bài viết hoặc mở chi tiết bài viết nếu cần
          const postEl = document.querySelector(`[data-post-id="${postId}"]`);
          if (postEl) {
            postEl.scrollIntoView({ behavior: 'smooth' });
          }
        }
      }
    });
  }
}

async function fetchNotifications() {
  const user = getCurrentUser();
  if (!user) return;

  const { data, error } = await supabase
    .from('notifications')
    .select(`
      id, type, post_id, is_read, created_at,
      actor:profiles!notifications_actor_id_fkey (id, full_name, avatar_url)
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (!error && data) {
    notifications = data;
    renderNotifications();
  }
}

function renderNotifications() {
  const listEl = $('notification-list');
  const badgeEl = $('notification-badge');
  if (!listEl || !badgeEl) return;

  const unreadCount = notifications.filter(n => !n.is_read).length;

  // Hiển thị hoặc ẩn số lượng trên chuông
  if (unreadCount > 0) {
    badgeEl.textContent = unreadCount > 99 ? '99+' : unreadCount;
    badgeEl.style.display = 'inline-block';
  } else {
    badgeEl.style.display = 'none';
  }

  if (notifications.length === 0) {
    listEl.innerHTML = `<div style="padding: 15px; text-align: center; color: #718096; font-size: 13px;">Không có thông báo nào</div>`;
    return;
  }

  listEl.innerHTML = notifications.map(n => {
    const actor = n.actor || {};
    const actionText = n.type === 'like' ? 'đã thích bài viết của bạn.' : 'đã bình luận bài viết của bạn.';
    const timeStr = new Date(n.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

    return `
      <div class="notification-item ${n.is_read ? '' : 'unread'}" data-post-id="${n.post_id || ''}" style="padding: 10px 15px; border-bottom: 1px solid #f0f2f5; display: flex; align-items: center; gap: 10px; cursor: pointer; background: ${n.is_read ? '#fff' : '#f0f2f5'};">
        <img src="${actor.avatar_url || 'https://ui-avatars.com/api/?name=User'}" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover;" alt="">
        <div style="flex: 1; font-size: 13px;">
          <div><strong>${escapeHtml(actor.full_name || 'Người dùng')}</strong> ${actionText}</div>
          <div style="font-size: 11px; color: #8a8d91; margin-top: 2px;">${timeStr}</div>
        </div>
      </div>
    `;
  }).join('');
}

async function markNotificationsAsRead() {
  const user = getCurrentUser();
  if (!user) return;

  const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id);
  if (unreadIds.length === 0) return;

  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .in('id', unreadIds);

  if (!error) {
    notifications.forEach(n => n.is_read = true);
    renderNotifications();
  }
}

function setupNotificationRealtime(userId) {
  supabase.channel('public:notifications')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${userId}`
    }, async payload => {
      // Lấy thêm thông tin profile của actor vừa tác động
      const { data: fullNotif } = await supabase
        .from('notifications')
        .select(`
          id, type, post_id, is_read, created_at,
          actor:profiles!notifications_actor_id_fkey (id, full_name, avatar_url)
        `)
        .eq('id', payload.new.id)
        .single();

      if (fullNotif) {
        notifications.unshift(fullNotif);
        renderNotifications();
      }
    })
    .subscribe();
}
