import { supabase, APP_CONFIG } from './supabase-client.js';
import { getCurrentUser } from './auth.js';
import { avatarFor, uploadImage, escapeHtml, filterProfanity, openUserProfile } from './profile.js';

const $ = id => document.getElementById(id);
let posts = [];
let replyTarget = null;
let newPostsBuffer = [];
let page = 0;
const PAGE_SIZE = 10;
let isLoading = false;
let hasMore = true;

const notifySound = new Audio('https://etquvhtzwqzjskmkxlog.supabase.co/storage/v1/object/public/assets/audio/notification.mp3');

function playNotificationSound() {
  notifySound.currentTime = 0;
  notifySound.play().catch(err => console.log('Chờ tương tác để phát âm thanh:', err));
}

function toast(msg, type='') { window.appToast?.(msg, type); }

function timeAgo(iso) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(seconds / 60);
  if (hours < 24) return `${hours} giờ`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày`;
  return new Intl.DateTimeFormat('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric' }).format(new Date(iso));
}

function fallbackAvatar(name='User') {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=e4eef8&color=24527a`;
}

async function loadPosts(reset = false) {
  if (isLoading || (!hasMore && !reset)) return;
  isLoading = true;

  if (reset) {
    page = 0;
    hasMore = true;
    posts = [];
    if ($('feed-list')) {
      $('feed-list').innerHTML = '<div style="text-align:center;padding:20px;color:#718096">Đang tải bảng tin...</div>';
    }
  }

  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  try {
    const { data, error } = await supabase
      .from('posts')
      .select(`
        id, user_id, content, image_url, privacy, created_at,
        profiles (id, full_name, avatar_url),
        post_likes (id, user_id, reaction_type, created_at),
        comments (
          id, post_id, user_id, parent_id, content, created_at, updated_at,
          profiles (id, full_name, avatar_url),
          comment_likes (id, user_id)
        )
      `)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;

    const newPosts = data || [];
    if (newPosts.length < PAGE_SIZE) {
      hasMore = false;
    }

    posts = reset ? newPosts : [...posts, ...newPosts];
    page++;
    renderFeedList();
  } catch (err) {
    console.error('Lỗi tải bài viết:', err.message);
    toast(err.message, 'error');
  } finally {
    isLoading = false;
  }
}

function renderFeedList() {
  const container = $('feed-list');
  if (!container) return;

  if (!posts.length) {
    container.innerHTML = `<div class="card" style="padding:30px;text-align:center;color:#718096">Chưa có bài viết phù hợp.</div>`;
    return;
  }

  container.innerHTML = posts.map(postHtml).join('');

  if (!hasMore) {
    container.insertAdjacentHTML('beforeend', '<div style="text-align:center;padding:15px;color:#a0aec0;font-size:13px">Bạn đã xem hết bài viết.</div>');
  }
}

function renderNewPostNotification() {
  let notifEl = $('new-posts-banner');
  const feedList = $('feed-list');
  if (!feedList) return;

  if (!notifEl && newPostsBuffer.length > 0) {
    notifEl = document.createElement('div');
    notifEl.id = 'new-posts-banner';
    notifEl.className = 'new-posts-banner';
    notifEl.innerHTML = `<span>Có bài viết mới</span>`;
    notifEl.onclick = () => {
      posts = [...newPostsBuffer, ...posts];
      newPostsBuffer = [];
      notifEl.remove();
      renderFeedList();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    feedList.parentNode.insertBefore(notifEl, feedList);
  } else if (notifEl) {
    if (newPostsBuffer.length > 0) {
      notifEl.style.display = 'block';
      notifEl.querySelector('span').textContent = `Có bài viết mới`;
    } else {
      notifEl.style.display = 'none';
    }
  }
}

const bannerStyle = document.createElement('style');
bannerStyle.innerHTML = `
  .new-posts-banner {
    background-color: #1877f2;
    color: white;
    text-align: center;
    padding: 10px;
    margin-bottom: 15px;
    border-radius: 8px;
    cursor: pointer;
    font-weight: bold;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    transition: background 0.2s;
  }
  .new-posts-banner:hover {
    background-color: #166fe5;
  }
`;
document.head.appendChild(bannerStyle);

function postHtml(post) {
  const user = post.profiles || {};
  const me = getCurrentUser();
  const likes = post.post_likes || [];
  const comments = post.comments || [];
  const liked = likes.some(x => x.user_id === me?.id);
  const image = post.image_url
    ? `<img class="post-image" src="${escapeHtml(post.image_url)}" alt="Ảnh bài viết" loading="lazy">`
    : '';

  return `<article class="post card" data-post-id="${post.id}">
    <div class="post-head">
      <img class="avatar clickable-user" data-user-id="${user.id}" src="${escapeHtml(user.avatar_url || fallbackAvatar(user.full_name))}" alt="">
      <div class="post-author">
        <strong class="clickable-user" data-user-id="${user.id}">${escapeHtml(user.full_name || 'User')}</strong>
        <span>${timeAgo(post.created_at)} · ${privacyLabel(post.privacy)}</span>
      </div>
      ${me?.id === post.user_id ? `<button class="icon-btn delete-post" title="Xóa bài">⋮</button>` : ''}
    </div>
    ${post.content ? `<div class="post-content">${escapeHtml(post.content)}</div>` : ''}
    ${image}
    <div class="post-stats">
      <button class="stat-link likes-count" data-action="likes">${likes.length} lượt thích</button>
      <span>${comments.length} bình luận</span>
    </div>
    <div class="post-actions">
      <button class="post-action ${liked ? 'liked' : ''}" data-action="like">👍 ${liked ? 'Đã thích' : 'Thích'}</button>
      <button class="post-action" data-action="focus-comment">💬 Bình luận</button>
    </div>
    <div class="comments">
      <div class="comment-tree">${renderComments(post)}</div>
      ${renderReplyState(post.id)}
      <form class="comment-form" data-post-id="${post.id}">
        <input class="input" name="content" maxlength="1000" autocomplete="off" placeholder="${replyTarget?.postId === post.id ? `Trả lời ${replyTarget.name}...` : 'Viết bình luận...'}">
        <button class="btn primary" type="submit">Gửi</button>
      </form>
    </div>
  </article>`;
}

function privacyLabel(p) {
  return p === 'friends' ? 'Bạn bè' : p === 'private' ? 'Riêng tư' : 'Công khai';
}

function renderComments(post) {
  const comments = [...(post.comments || [])].sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
  
  const rootComments = comments.filter(c => !c.parent_id);
  const repliesMap = new Map();

  comments.forEach(c => {
    if (c.parent_id) {
      let rootParentId = c.parent_id;
      const parentComment = comments.find(x => x.id === c.parent_id);
      if (parentComment && parentComment.parent_id) {
        rootParentId = parentComment.parent_id;
      }

      if (!repliesMap.has(rootParentId)) repliesMap.set(rootParentId, []);
      repliesMap.get(rootParentId).push(c);
    }
  });

  return rootComments.map(c => {
    const user = c.profiles || {};
    const liked = (c.comment_likes || []).some(x => x.user_id === getCurrentUser()?.id);
    const canDelete = getCurrentUser()?.id === c.user_id || getCurrentUser()?.id === post.user_id;
    const childReplies = repliesMap.get(c.id) || [];

    const rootHtml = `<div class="comment" data-comment-id="${c.id}">
      <img class="avatar clickable-user" data-user-id="${user.id}" style="width:32px;height:32px" src="${escapeHtml(user.avatar_url || fallbackAvatar(user.full_name))}" alt="">
      <div class="comment-body">
        <div class="comment-bubble">
          <strong class="clickable-user" data-user-id="${user.id}">${escapeHtml(user.full_name || 'User')}</strong>
          <p>${escapeHtml(c.content)}</p>
        </div>
        <div class="comment-tools">
          <button data-comment-action="like" class="${liked ? 'liked' : ''}">♥ ${(c.comment_likes || []).length}</button>
          <button data-comment-action="reply" data-author-name="${escapeHtml(user.full_name || 'User')}">Trả lời</button>
          ${canDelete ? '<button data-comment-action="delete">Xóa</button>' : ''}
          <span>${timeAgo(c.created_at)}</span>
        </div>
        
        <div class="comment-replies">
          ${childReplies.map(reply => {
            const rUser = reply.profiles || {};
            const rLiked = (reply.comment_likes || []).some(x => x.user_id === getCurrentUser()?.id);
            const rCanDelete = getCurrentUser()?.id === reply.user_id || getCurrentUser()?.id === post.user_id;
            return `<div class="comment reply" data-comment-id="${reply.id}">
              <img class="avatar clickable-user" data-user-id="${rUser.id}" style="width:28px;height:28px" src="${escapeHtml(rUser.avatar_url || fallbackAvatar(rUser.full_name))}" alt="">
              <div class="comment-body">
                <div class="comment-bubble">
                  <strong class="clickable-user" data-user-id="${rUser.id}">${escapeHtml(rUser.full_name || 'User')}</strong>
                  <p>${escapeHtml(reply.content)}</p>
                </div>
                <div class="comment-tools">
                  <button data-comment-action="like" class="${rLiked ? 'liked' : ''}">♥ ${(reply.comment_likes || []).length}</button>
                  <button data-comment-action="reply" data-author-name="${escapeHtml(rUser.full_name || 'User')}">Trả lời</button>
                  ${rCanDelete ? '<button data-comment-action="delete">Xóa</button>' : ''}
                  <span>${timeAgo(reply.created_at)}</span>
                </div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>`;

    return rootHtml;
  }).join('');
}

function renderReplyState(postId) {
  if (!replyTarget || replyTarget.postId !== postId) return '';
  return `<div class="reply-state"><span>Đang trả lời <strong>${escapeHtml(replyTarget.name)}</strong></span><button type="button" class="cancel-reply">Hủy</button></div>`;
}

function findPost(postId) { return posts.find(p => p.id === postId); }

async function checkPostLimit(userId) {
  const startOfDay = new Date();
  startOfDay.setHours(0,0,0,0);

  const { count, error } = await supabase
    .from('posts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', startOfDay.toISOString());

  if (error) return true;
  return (count || 0) < 5;
}

async function submitPost(event) {
  event.preventDefault();
  const user = getCurrentUser();
  if (!user) return;

  const rawContent = $('post-content').value.trim();
  const content = filterProfanity(rawContent);
  const url = $('post-image-url').value.trim();
  const file = $('post-image').files[0];

  if (content.length > 280) {
    toast('Độ dài status không được quá 280 ký tự.', 'error');
    return;
  }

  if (!content && !url && !file) {
    toast('Bài viết cần nội dung hoặc ảnh.', 'error');
    return;
  }

  const canPost = await checkPostLimit(user.id);
  if (!canPost) {
    toast('Bạn đã đạt giới hạn 5 bài đăng trong ngày hôm nay.', 'error');
    return;
  }

  try {
    let imageUrl = url || null;
    if (file) imageUrl = await uploadImage(file, APP_CONFIG.mediaBucket, user.id);

    const { error } = await supabase.from('posts').insert({
      user_id: user.id,
      content,
      image_url: imageUrl,
      privacy: $('post-privacy').value
    });
    if (error) throw error;

    event.target.reset();
    $('post-image-preview').classList.add('hidden');
    toast('Đã đăng bài.', 'success');
    await loadPosts(true);
  } catch (err) {
    toast(err.message || 'Không thể đăng bài.', 'error');
  }
}

async function togglePostLike(postId) {
  const user = getCurrentUser();
  const post = findPost(postId);
  if (!user || !post) return;

  if (!post.post_likes) post.post_likes = [];

  const existing = post.post_likes.find(x => x.user_id === user.id);
  
  if (existing) {
    const { error } = await supabase.from('post_likes').delete().eq('id', existing.id);
    if (error) {
      toast(error.message, 'error');
      return;
    }
    post.post_likes = post.post_likes.filter(x => x.id !== existing.id);
  } else {
    const { data, error } = await supabase.from('post_likes').insert({
      post_id: postId, 
      user_id: user.id, 
      reaction_type: 'like'
    }).select().single();

    if (error) {
      toast(error.message, 'error');
      return;
    }
    if (data) {
      post.post_likes.push(data);
    }
  }

  renderFeedList();
}

async function showPostLikes(postId) {
  const post = findPost(postId);
  if (!post) return;
  const ids = [...new Set((post.post_likes || []).map(x => x.user_id))];
  $('likes-list').innerHTML = '<div style="color:#718096">Đang tải...</div>';
  $('likes-modal').classList.remove('hidden');

  if (!ids.length) {
    $('likes-list').innerHTML = '<div style="color:#718096;padding:10px">Chưa có lượt thích.</div>';
    return;
  }

  const { data, error } = await supabase.from('profiles').select('id,full_name,avatar_url').in('id', ids);
  if (error) {
    toast(error.message, 'error');
    return;
  }
  $('likes-list').innerHTML = (data || []).map(p => `
    <div class="person">
      <img class="avatar clickable-user" data-user-id="${p.id}" src="${escapeHtml(p.avatar_url || fallbackAvatar(p.full_name))}" alt="">
      <div class="person-info"><strong class="clickable-user" data-user-id="${p.id}">${escapeHtml(p.full_name)}</strong></div>
    </div>`).join('');
}

async function submitComment(event) {
  event.preventDefault();
  const user = getCurrentUser();
  const form = event.target.closest('form') || event.currentTarget;
  if (!form) return;

  const postId = form.dataset.postId;
  const inputEl = form.querySelector('input[name="content"]') || form.querySelector('input');
  const rawContent = inputEl ? inputEl.value.trim() : '';

  if (!user) {
    toast('Vui lòng đăng nhập để bình luận.', 'error');
    return;
  }

  if (!rawContent) return;
  const content = filterProfanity(rawContent);

  const { error } = await supabase.from('comments').insert({
    post_id: postId,
    user_id: user.id,
    parent_id: replyTarget?.postId === postId ? replyTarget.commentId : null,
    content
  });

  if (error) {
    toast(error.message, 'error');
  } else {
    replyTarget = null;
    form.reset();
  }
}

async function deleteComment(commentId) {
  if (!confirm('Xóa bình luận này và toàn bộ trả lời bên dưới?')) return;
  
  const { error } = await supabase.from('comments').delete().eq('id', commentId);
  if (error) {
    toast(error.message, 'error');
    return;
  }

  posts.forEach(post => {
    if (post.comments) {
      post.comments = post.comments.filter(c => c.id !== commentId && c.parent_id !== commentId);
    }
  });

  renderFeedList();
  toast('Đã xóa bình luận.', 'success');
}

async function toggleCommentLike(commentId) {
  const user = getCurrentUser();
  if (!user) return;

  let targetComment = null;

  for (const post of posts) {
    if (post.comments) {
      const found = post.comments.find(c => c.id === commentId);
      if (found) {
        targetComment = found;
        break;
      }
    }
  }

  if (!targetComment) return;
  if (!targetComment.comment_likes) targetComment.comment_likes = [];

  const existing = targetComment.comment_likes.find(x => x.user_id === user.id);

  if (existing) {
    const { error } = await supabase.from('comment_likes').delete().eq('id', existing.id);
    if (error) {
      toast(error.message, 'error');
      return;
    }
    targetComment.comment_likes = targetComment.comment_likes.filter(x => x.id !== existing.id);
  } else {
    const { data, error } = await supabase.from('comment_likes').insert({
      comment_id: commentId, 
      user_id: user.id
    }).select().single();

    if (error) {
      toast(error.message, 'error');
      return;
    }
    if (data) {
      targetComment.comment_likes.push(data);
    }
  }

  renderFeedList();
}

async function deletePost(postId) {
  if (!confirm('Bạn chắc muốn xóa bài viết?')) return;
  const { error } = await supabase.from('posts').delete().eq('id', postId);
  if (error) toast(error.message, 'error');
}

function handleFeedClick(event) {
  const userBtn = event.target.closest('.clickable-user');
  if (userBtn && userBtn.dataset.userId) {
    openUserProfile(userBtn.dataset.userId);
    return;
  }

  const postEl = event.target.closest('[data-post-id]');
  if (!postEl) return;
  const postId = postEl.dataset.postId;

  const action = event.target.closest('[data-action]')?.dataset.action;
  
  if (action === 'like') return togglePostLike(postId);
  if (action === 'likes') return showPostLikes(postId);
  
  if (action === 'focus-comment') {
    const input = postEl.querySelector('.comment-form input');
    if (input) input.focus();
    return;
  }

  const commentEl = event.target.closest('[data-comment-id]');
  if (commentEl) {
    const commentId = commentEl.dataset.commentId;
    const cAction = event.target.closest('[data-comment-action]')?.dataset.commentAction;
    const post = findPost(postId);
    const comment = post?.comments?.find(c => c.id === commentId);
    
    if (cAction === 'like') return toggleCommentLike(commentId);
    if (cAction === 'reply') {
      const authorName = comment?.profiles?.full_name || 'User';
      const targetParentId = comment?.parent_id ? comment.parent_id : commentId;

      replyTarget = { postId, commentId: targetParentId, name: authorName };
      renderFeedList();
      
      const input = postEl.querySelector('.comment-form input');
      if (input) {
        input.value = `@${authorName} `;
        input.focus();
      }
      return;
    }
    if (cAction === 'delete') return deleteComment(commentId);
  }

  if (event.target.closest('.cancel-reply')) {
    replyTarget = null;
    renderFeedList();
    return;
  }
  
  if (event.target.closest('.delete-post')) deletePost(postId);
}

function previewPostImage() {
  const file = $('post-image').files[0];
  if (!file) {
    $('post-image-preview').classList.add('hidden');
    return;
  }
  const url = URL.createObjectURL(file);
  $('post-image-preview').innerHTML = `<img src="${url}" alt="Preview">`;
  $('post-image-preview').classList.remove('hidden');
}

function setupInfiniteScroll() {
  window.addEventListener('scroll', () => {
    const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
    if (scrollTop + clientHeight >= scrollHeight - 200) {
      loadPosts(false);
    }
  });
}

export function initFeed() {
  if ($('post-form')) $('post-form').addEventListener('submit', submitPost);
  if ($('post-image')) $('post-image').addEventListener('change', previewPostImage);
  if ($('feed-list')) {
    $('feed-list').addEventListener('click', handleFeedClick);
    $('feed-list').addEventListener('submit', e => {
      if (e.target.closest('.comment-form')) {
        submitComment(e);
      }
    });
  }

  if ($('likes-modal')) {
    $('likes-modal').addEventListener('click', e => {
      const userBtn = e.target.closest('.clickable-user');
      if (userBtn && userBtn.dataset.userId) {
        $('likes-modal').classList.add('hidden');
        openUserProfile(userBtn.dataset.userId);
      }
    });
  }

  setupInfiniteScroll();

  window.addEventListener('auth-ready', () => loadPosts(true));
  window.addEventListener('profile-updated', () => loadPosts(true));

  supabase.channel('feed-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, async payload => {
      const me = getCurrentUser();
      if (!payload.new) return;

      if (me && payload.new.user_id === me.id) {
        loadPosts(true);
        return;
      }

      const { data: fullPost, error } = await supabase
        .from('posts')
        .select(`
          id, user_id, content, image_url, privacy, created_at,
          profiles (id, full_name, avatar_url),
          post_likes (id, user_id, reaction_type, created_at),
          comments (
            id, post_id, user_id, parent_id, content, created_at, updated_at,
            profiles (id, full_name, avatar_url),
            comment_likes (id, user_id)
          )
        `)
        .eq('id', payload.new.id)
        .single();

      if (!error && fullPost) {
        newPostsBuffer.unshift(fullPost);
        renderNewPostNotification();
      }
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'post_likes' }, async payload => {
      const me = getCurrentUser();
      if (!me || !payload.new) return;

      const { data: postData } = await supabase
        .from('posts')
        .select('user_id')
        .eq('id', payload.new.post_id)
        .single();

      if (postData && postData.user_id === me.id && payload.new.user_id !== me.id) {
        await supabase.from('notifications').insert({
          user_id: postData.user_id,
          actor_id: payload.new.user_id,
          type: 'like',
          post_id: payload.new.post_id
        });

        playNotificationSound();
        toast('👍 Có người đã thích bài viết của bạn!', 'info');
      }

      const targetPost = posts.find(p => p.id === payload.new.post_id);
      if (targetPost) {
        if (!targetPost.post_likes) targetPost.post_likes = [];
        if (!targetPost.post_likes.some(l => l.id === payload.new.id)) {
          targetPost.post_likes.push(payload.new);
          renderFeedList();
        }
      }
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments' }, async payload => {
      const me = getCurrentUser();
      if (!me || !payload.new) return;

      const { data: postData } = await supabase
        .from('posts')
        .select('user_id')
        .eq('id', payload.new.post_id)
        .single();

      if (postData && postData.user_id === me.id && payload.new.user_id !== me.id) {
        await supabase.from('notifications').insert({
          user_id: postData.user_id,
          actor_id: payload.new.user_id,
          type: 'comment',
          post_id: payload.new.post_id
        });

        playNotificationSound();
        toast('💬 Có người đã bình luận bài viết của bạn!', 'info');
      }

      const targetPost = posts.find(p => p.id === payload.new.post_id);
      if (targetPost) {
        const { data: updatedComments } = await supabase
          .from('comments')
          .select(`
            id, post_id, user_id, parent_id, content, created_at, updated_at,
            profiles (id, full_name, avatar_url),
            comment_likes (id, user_id)
          `)
          .eq('post_id', targetPost.id);
        
        if (updatedComments) {
          targetPost.comments = updatedComments;
          renderFeedList();
        }
      }
    })
    .subscribe();
}
