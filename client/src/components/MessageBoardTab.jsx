import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import styles from './MessageBoardTab.module.css';

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

function Message({ msg, replies, user, onReply, onDelete }) {
  const [showReplyBox, setShowReplyBox] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef(null);

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
        <div className={styles.messageContent}>{msg.content}</div>
        <div className={styles.messageActions}>
          <button className={styles.actionBtn} onClick={() => setShowReplyBox(!showReplyBox)}>
            Reply
          </button>
          {canDelete && (
            <button className={styles.actionBtn} onClick={() => onDelete(msg.id)}>
              Delete
            </button>
          )}
        </div>
      </div>

      {replies.map((r) => (
        <div key={r.id} className={`${styles.message} ${styles.reply}`}>
          <div className={styles.messageHeader}>
            {r.user_avatar ? (
              <img src={r.user_avatar} alt="" className={styles.avatar} />
            ) : (
              <div className={styles.avatarPlaceholder}>{r.user_name[0]}</div>
            )}
            <span className={styles.userName}>{r.user_name}</span>
            <span className={styles.time}>{formatTime(r.created_at)}</span>
          </div>
          <div className={styles.messageContent}>{r.content}</div>
          {(r.user_id === user.id || user.is_admin) && (
            <div className={styles.messageActions}>
              <button className={styles.actionBtn} onClick={() => onDelete(r.id)}>
                Delete
              </button>
            </div>
          )}
        </div>
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
      setMessages((prev) => [...prev, data.message]);
      setNewPost('');
    } catch (err) {
      setError(err.message);
    }
    setPosting(false);
  };

  const handleReply = async (parentId, content) => {
    setError('');
    try {
      const data = await api.post('/api/messages', { content, parent_id: parentId });
      setMessages((prev) => [...prev, data.message]);
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

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handlePost();
    }
  };

  // Group into threads: top-level messages with their replies
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
        <textarea
          className={styles.composeInput}
          value={newPost}
          onChange={(e) => setNewPost(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What's on your mind?"
          maxLength={2000}
          rows={2}
        />
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
          />
        ))
      )}
    </div>
  );
}
