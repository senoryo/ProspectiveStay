import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import styles from './MessageBoardTab.module.css';

function GifPickerPopup({ show, onSelect, onClose, triggerRef }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!show || !triggerRef?.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const isMobile = window.innerWidth <= 600;
    const pickerW = isMobile ? window.innerWidth - 16 : 340;
    const pickerH = isMobile ? 360 : 420;
    let top = rect.top - pickerH - 8;
    let left = isMobile ? 8 : rect.left;
    if (top < 8) top = rect.bottom + 8;
    if (left + pickerW > window.innerWidth - 8) left = window.innerWidth - pickerW - 8;
    if (left < 8) left = 8;
    if (top + pickerH > window.innerHeight - 8) top = window.innerHeight - pickerH - 8;
    setPos({ top, left });
  }, [show, triggerRef]);

  useEffect(() => {
    if (!show) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [show, onClose]);

  const fetchGifs = async (q) => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get(`/api/giphy/search?q=${encodeURIComponent(q)}`);
      setGifs(data.gifs || []);
    } catch (err) {
      setError(err.message);
      setGifs([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!show) { setGifs([]); setQuery(''); return; }
    fetchGifs('');
  }, [show]);

  const handleSearch = (val) => {
    setQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchGifs(val), 400);
  };

  if (!show) return null;

  return createPortal(
    <div ref={ref} className={styles.gifPickerWrap} style={{ top: pos.top, left: pos.left }}>
      <input
        className={styles.gifSearch}
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
        placeholder="Search GIFs..."
        autoFocus
      />
      <div className={styles.gifGrid}>
        {loading && <div className={styles.gifLoading}>Loading...</div>}
        {error && <div className={styles.gifError}>{error}</div>}
        {!loading && !error && gifs.length === 0 && <div className={styles.gifLoading}>No GIFs found</div>}
        {gifs.map((g) => (
          <img
            key={g.id}
            src={g.preview}
            alt={g.title}
            className={styles.gifItem}
            onClick={() => onSelect(g.url)}
          />
        ))}
      </div>
      <div className={styles.gifPowered}>Powered by GIPHY</div>
    </div>,
    document.body
  );
}

function EmojiPickerPopup({ show, onSelect, onClose, triggerRef }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!show || !triggerRef?.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const isMobile = window.innerWidth <= 600;
    const pickerW = isMobile ? window.innerWidth - 16 : 320;
    const pickerH = isMobile ? 350 : 400;
    let top = rect.top - pickerH - 8;
    let left = isMobile ? 8 : rect.left;
    if (top < 8) top = rect.bottom + 8;
    if (left + pickerW > window.innerWidth - 8) left = window.innerWidth - pickerW - 8;
    if (left < 8) left = 8;
    if (top + pickerH > window.innerHeight - 8) top = window.innerHeight - pickerH - 8;
    setPos({ top, left });
  }, [show, triggerRef]);

  useEffect(() => {
    if (!show) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [show, onClose]);

  if (!show) return null;

  const isMobile = window.innerWidth <= 600;

  return createPortal(
    <div ref={ref} className={styles.emojiPickerWrap} style={{ top: pos.top, left: pos.left }}>
      <EmojiPicker
        theme={Theme.DARK}
        onEmojiClick={(emojiData) => onSelect(emojiData.emoji)}
        width={isMobile ? window.innerWidth - 16 : 320}
        height={isMobile ? 350 : 400}
        searchPlaceholder="Search emoji..."
        previewConfig={{ showPreview: false }}
      />
    </div>,
    document.body
  );
}

function formatTime(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

function Reactions({ reactions, userId, onToggle }) {
  // Group reactions: { emoji: { count, users[], userReacted } }
  const grouped = {};
  for (const r of reactions) {
    if (!grouped[r.emoji]) grouped[r.emoji] = { count: 0, users: [], userReacted: false };
    grouped[r.emoji].count++;
    grouped[r.emoji].users.push(r.user_name);
    if (r.user_id === userId) grouped[r.emoji].userReacted = true;
  }

  if (Object.keys(grouped).length === 0) return null;

  return (
    <div className={styles.reactions}>
      {Object.entries(grouped).map(([emoji, data]) => (
        <button
          key={emoji}
          className={`${styles.reactionPill} ${data.userReacted ? styles.reactionActive : ''}`}
          onClick={() => onToggle(emoji)}
          title={data.users.join(', ')}
        >
          <span className={styles.reactionEmoji}>{emoji}</span>
          <span className={styles.reactionCount}>{data.count}</span>
        </button>
      ))}
    </div>
  );
}

function SingleMessage({ msg, user, onDelete, onReact, isReply }) {
  const [showReactPicker, setShowReactPicker] = useState(false);
  const reactBtnRef = useRef(null);
  const canDelete = msg.user_id === user.id || user.is_admin;

  return (
    <div className={`${styles.message} ${isReply ? styles.reply : ''}`}>
      <div className={styles.messageHeader}>
        {msg.user_avatar ? (
          <img src={msg.user_avatar} alt="" className={styles.avatar} />
        ) : (
          <div className={styles.avatarPlaceholder}>{msg.user_name[0]}</div>
        )}
        <span className={styles.userName}>{msg.user_name}</span>
        <span className={styles.time}>{formatTime(msg.created_at)}</span>
      </div>
      {msg.content && <div className={styles.messageContent}>{msg.content}</div>}
      {msg.gif_url && <img src={msg.gif_url} alt="GIF" className={styles.messageGif} />}
      <Reactions reactions={msg.reactions || []} userId={user.id} onToggle={(emoji) => onReact(msg.id, emoji)} />
      <div className={styles.messageActions}>
        {!isReply && null /* Reply button added by parent */}
        <div className={styles.reactBtnWrap}>
          <button ref={reactBtnRef} className={styles.actionBtn} onClick={() => setShowReactPicker(!showReactPicker)}>
            😀
          </button>
          <EmojiPickerPopup
            show={showReactPicker}
            triggerRef={reactBtnRef}
            onSelect={(emoji) => { onReact(msg.id, emoji); setShowReactPicker(false); }}
            onClose={() => setShowReactPicker(false)}
          />
        </div>
        {canDelete && (
          <button className={styles.actionBtn} onClick={() => onDelete(msg.id)}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function Message({ msg, replies, user, onReply, onDelete, onReact }) {
  const [showReplyBox, setShowReplyBox] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showReactPicker, setShowReactPicker] = useState(false);
  const inputRef = useRef(null);
  const reactBtnRef = useRef(null);
  const replyEmojiBtnRef = useRef(null);
  const replyGifBtnRef = useRef(null);
  const [showReplyGif, setShowReplyGif] = useState(false);

  const handleReply = async () => {
    if (!replyText.trim()) return;
    setSending(true);
    const ok = await onReply(msg.id, replyText.trim());
    if (ok) {
      setReplyText('');
      setShowReplyBox(false);
    }
    setSending(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleReply();
    }
  };

  useEffect(() => {
    if (showReplyBox && inputRef.current) inputRef.current.focus();
  }, [showReplyBox]);

  const canDelete = msg.user_id === user.id || user.is_admin;

  return (
    <div className={styles.thread}>
      <div className={styles.message}>
        <div className={styles.messageHeader}>
          {msg.user_avatar ? (
            <img src={msg.user_avatar} alt="" className={styles.avatar} />
          ) : (
            <div className={styles.avatarPlaceholder}>{msg.user_name[0]}</div>
          )}
          <span className={styles.userName}>{msg.user_name}</span>
          <span className={styles.time}>{formatTime(msg.created_at)}</span>
        </div>
        {msg.content && <div className={styles.messageContent}>{msg.content}</div>}
        {msg.gif_url && <img src={msg.gif_url} alt="GIF" className={styles.messageGif} />}
        <Reactions reactions={msg.reactions || []} userId={user.id} onToggle={(emoji) => onReact(msg.id, emoji)} />
        <div className={styles.messageActions}>
          <button className={styles.actionBtn} onClick={() => setShowReplyBox(!showReplyBox)}>
            Reply
          </button>
          <div className={styles.reactBtnWrap}>
            <button ref={reactBtnRef} className={styles.actionBtn} onClick={() => setShowReactPicker(!showReactPicker)}>
              😀
            </button>
            <EmojiPickerPopup
              show={showReactPicker}
              triggerRef={reactBtnRef}
              onSelect={(emoji) => { onReact(msg.id, emoji); setShowReactPicker(false); }}
              onClose={() => setShowReactPicker(false)}
            />
          </div>
          {canDelete && (
            <button className={styles.actionBtn} onClick={() => onDelete(msg.id)}>
              Delete
            </button>
          )}
        </div>
      </div>

      {replies.map((r) => (
        <SingleMessage
          key={r.id}
          msg={r}
          user={user}
          onDelete={onDelete}
          onReact={onReact}
          isReply
        />
      ))}

      {showReplyBox && (
        <div className={styles.replyBox}>
          <input
            ref={inputRef}
            className={styles.replyInput}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Write a reply..."
            maxLength={2000}
          />
          <button
            ref={replyEmojiBtnRef}
            type="button"
            className={styles.replyIconBtn}
            onClick={() => setShowEmoji(!showEmoji)}
          >
            😀
          </button>
          <EmojiPickerPopup
            show={showEmoji}
            triggerRef={replyEmojiBtnRef}
            onSelect={(e) => { setReplyText((t) => t + e); setShowEmoji(false); }}
            onClose={() => setShowEmoji(false)}
          />
          <button
            ref={replyGifBtnRef}
            type="button"
            className={styles.replyGifBtn}
            onClick={() => setShowReplyGif(!showReplyGif)}
          >
            GIF
          </button>
          <GifPickerPopup
            show={showReplyGif}
            triggerRef={replyGifBtnRef}
            onSelect={async (url) => { setShowReplyGif(false); await onReply(msg.id, null, url); }}
            onClose={() => setShowReplyGif(false)}
          />
          <button className={styles.replyBtn} onClick={handleReply} disabled={sending || !replyText.trim()}>
            {sending ? '...' : 'Reply'}
          </button>
          <button className={styles.cancelBtn} onClick={() => { setShowReplyBox(false); setReplyText(''); }}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

export default function MessageBoardTab() {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [newPost, setNewPost] = useState('');
  const [error, setError] = useState('');
  const [posting, setPosting] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const composeEmojiBtnRef = useRef(null);
  const composeGifBtnRef = useRef(null);

  const fetchMessages = async () => {
    try {
      const data = await api.get('/api/messages');
      setMessages(data.messages);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => { fetchMessages(); }, []);

  const handlePost = async () => {
    if (!newPost.trim()) return;
    setPosting(true);
    setError('');
    try {
      const data = await api.post('/api/messages', { content: newPost.trim() });
      setMessages((prev) => [...prev, { ...data.message, reactions: [] }]);
      setNewPost('');
    } catch (err) {
      setError(err.message);
    }
    setPosting(false);
  };

  const handlePostGif = async (gifUrl) => {
    setPosting(true);
    setError('');
    setShowGifPicker(false);
    try {
      const data = await api.post('/api/messages', { content: '', gif_url: gifUrl });
      setMessages((prev) => [...prev, { ...data.message, reactions: [] }]);
    } catch (err) {
      setError(err.message);
    }
    setPosting(false);
  };

  const handleReply = async (parentId, content, gifUrl) => {
    setError('');
    try {
      const body = { parent_id: parentId };
      if (content) body.content = content;
      if (gifUrl) body.gif_url = gifUrl;
      const data = await api.post('/api/messages', body);
      setMessages((prev) => [...prev, { ...data.message, reactions: [] }]);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  };

  const handleDelete = async (id) => {
    setError('');
    try {
      await api.delete(`/api/messages/${id}`);
      setMessages((prev) => prev.filter((m) => m.id !== id && m.parent_id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleReact = async (messageId, emoji) => {
    try {
      const data = await api.post(`/api/messages/${messageId}/reactions`, { emoji });
      // Update reactions locally
      setMessages((prev) => prev.map((m) => {
        if (m.id !== messageId) return m;
        const reactions = [...(m.reactions || [])];
        if (data.action === 'added') {
          reactions.push({ emoji, user_id: user.id, user_name: user.name, message_id: messageId });
        } else {
          const idx = reactions.findIndex((r) => r.emoji === emoji && r.user_id === user.id);
          if (idx !== -1) reactions.splice(idx, 1);
        }
        return { ...m, reactions };
      }));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handlePost();
    }
  };

  const topLevel = messages.filter((m) => !m.parent_id);
  const repliesByParent = {};
  for (const m of messages) {
    if (m.parent_id) {
      if (!repliesByParent[m.parent_id]) repliesByParent[m.parent_id] = [];
      repliesByParent[m.parent_id].push(m);
    }
  }

  return (
    <div className={styles.container}>
      <h2>Message Board</h2>

      <div className={styles.composeBox}>
        <div className={styles.composeWrap}>
          <textarea
            className={styles.composeInput}
            value={newPost}
            onChange={(e) => setNewPost(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What's on your mind?"
            maxLength={2000}
            rows={2}
          />
          <button
            ref={composeEmojiBtnRef}
            type="button"
            className={styles.emojiToggle}
            onClick={() => setShowEmoji(!showEmoji)}
          >
            😀
          </button>
          <EmojiPickerPopup
            show={showEmoji}
            triggerRef={composeEmojiBtnRef}
            onSelect={(e) => { setNewPost((t) => t + e); setShowEmoji(false); }}
            onClose={() => setShowEmoji(false)}
          />
          <button
            ref={composeGifBtnRef}
            type="button"
            className={styles.gifToggle}
            onClick={() => setShowGifPicker(!showGifPicker)}
          >
            GIF
          </button>
          <GifPickerPopup
            show={showGifPicker}
            triggerRef={composeGifBtnRef}
            onSelect={handlePostGif}
            onClose={() => setShowGifPicker(false)}
          />
        </div>
        <button className={styles.composeBtn} onClick={handlePost} disabled={posting || !newPost.trim()}>
          {posting ? 'Posting...' : 'Post'}
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {topLevel.length === 0 ? (
        <p className={styles.empty}>No messages yet. Be the first to post!</p>
      ) : (
        [...topLevel].reverse().map((msg) => (
          <Message
            key={msg.id}
            msg={msg}
            replies={repliesByParent[msg.id] || []}
            user={user}
            onReply={handleReply}
            onDelete={handleDelete}
            onReact={handleReact}
          />
        ))
      )}
    </div>
  );
}
