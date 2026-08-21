import { supabase } from './supabase-client.js';
import { getCurrentUser } from './auth.js';
import { escapeHtml } from './profile.js';

let notifPage = 0;
const NOTIF_PAGE_SIZE = 5;
let notifLoading = false;
let notifHasMore = true;

const $ = id => document.getElementById(id);

export function initNotifications() {
  const btn = $('notification-btn');
  const dropdown = $('notification-dropdown');
  const listEl = $('notification-list');
  const markAllBtn = $('mark-all-read');

  if (!btn || !dropdown) return;

  // Bấm vào nút chuông để mở/đóng popup thông báo
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = dropdown.classList.toggle('hidden');
    if (!isHidden) {
      notifPage = 0;
      notifHasMore = true;
      loadNotifications(true);
      updateUnreadBadge(0); // Ẩn hoặc reset số đếm khi mở xem
    }
  });

  // Đóng popup khi click ra ngoài
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });

  // Cuộn trong danh sách thông báo (Load 5 thông báo tiếp theo)
  if (listEl) {
    listEl.addEventListener('scroll', () => {
      if (listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 20) {
        loadNotifications(false);
      }
    });
  }

  // Đánh dấu tất cả đã đọc
  if (markAllBtn) {
    markAllBtn.addEventListener('click', async () => {
      const user = getCurrentUser();
      if (!user) return;
      await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id);
      loadNotifications(true);
    });
  }

  // Lắng nghe Realtime thông báo mới đổ về
  setupRealtimeNotifications();
  fetchUnreadCount();
}

async function loadNotifications(reset = false) {
  const user = getCurrentUser();
  const listEl = $('notification-list');
  if (!user || !listEl || notifLoading || (!notifHasMore && !reset)) return;
  notifLoading = true;

  if (reset) {
    notifPage = 0;
    notifHasMore = true;
    listEl.innerHTML = '<div style="padding:15px;text-align:center;color:#718096;font-size:13px">Đang tải...</div>';
  }

  const from = notifPage * NOTIF_PAGE_SIZE;
  const to = from + NOTIF_PAGE_SIZE - 1;

  try {
    const { data, error } = await supabase
      .from('notifications')
      .select(`
        id, type, post_id, is_read, created_at,
        actor:actor_id(id, full_name, avatar_url)
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;

    const items = data || [];
    if (items.length < NOTIF_PAGE_SIZE) {
      notifHasMore = false;
    }

    const htmlContent = items.map(n => {
      const actor = n.actor || {};
      const actionText = n.type === 'like' ? 'đã thích bài viết của bạn.' : 'đã bình luận bài viết của bạn.';
      const avatarUrl = actor.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(actor.full_name || 'User')}&background=e4eef8&color=24527a`;
      
      return `
        <div class="notif-item ${n.is_read ? '' : 'unread'}" data-notif-id="${n.id}" data-post-id="${n.post_id}">
          <img class="notif-avatar" src="${escapeHtml(avatarUrl)}" alt="">
          <div style="flex: 1;">
            <strong>${escapeHtml(actor.full_name || 'Người dùng')}</strong> ${actionText}
            <div style="font-size: 11px; color: #8a8d91; margin-top: 2px;">${new Date(n.created_at).toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'})} ngày ${new Date(n.created_at).toLocaleDateString('vi-VN')}</div>
          </div>
        </div>
      `;
    }).join('');

    if (reset) {
      listEl.innerHTML = items.length ? htmlContent : '<div style="padding: 15px; text-align: center; color: #718096; font-size: 13px;">Chưa có thông báo nào.</div>';
    } else {
      if (items.length) listEl.insertAdjacentHTML('beforeend', htmlContent);
    }

    notifPage++;

    // Gắn sự kiện bấm vào từng thông báo để chuyển hướng tới bài viết
    listEl.querySelectorAll('.notif-item').forEach(el => {
      el.onclick = async () => {
        const notifId = el.dataset.notifId;
        const postId = el.dataset.postId;
        
        // Đánh dấu đã đọc thông báo này
        await supabase.from('notifications').update({ is_read: true }).eq('id', notifId);
        el.classList.remove('unread');
        
        // Đóng popup và cuộn tới bài viết tương ứng trên trang
        $('notification-dropdown').classList.add('hidden');
        const postNode = document.querySelector(`[data-post-id="${postId}"]`);
        if (postNode) {
          postNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
          postNode.style.border = '2px solid #1877f2';
          setTimeout(() => postNode.style.border = '', 2000);
        }
      };
    });

  } catch (err) {
    console.error('Lỗi tải thông báo:', err.message);
  } finally {
    notifLoading = false;
  }
}

async function fetchUnreadCount() {
  const user = getCurrentUser();
  if (!user) return;
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('is_read', false);

  if (!error && count > 0) {
    updateUnreadBadge(count);
  }
}

function updateUnreadBadge(count) {
  const badge = $('notification-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

function setupRealtimeNotifications() {
  supabase.channel('global-notifications')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, payload => {
      const user = getCurrentUser();
      if (user && payload.new && payload.new.user_id === user.id) {
        fetchUnreadCount();
      }
    })
    .subscribe();
}
