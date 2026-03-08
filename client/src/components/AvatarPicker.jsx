import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import styles from './AvatarPicker.module.css';

const AVATARS = [
  // American actors
  'Arnold Schwarzenegger', 'Brad Pitt', 'Bruce Willis', 'Cate Blanchett',
  'Chris Pratt', 'Clint Eastwood', 'Danny DeVito', 'Denzel Washington',
  'Dwayne Johnson', 'Eddie Murphy', 'Emma Stone', 'Harrison Ford',
  'Jack Nicholson', 'Jackie Chan', 'Jeff Goldblum', 'Jim Carrey',
  'Johnny Depp', 'Keanu Reeves', 'Leonardo DiCaprio', 'Margot Robbie',
  'Meryl Streep', 'Morgan Freeman', 'Nicolas Cage', 'Oprah Winfrey',
  'Robert De Niro', 'Robert Downey Jr.', 'Robin Williams', 'Ryan Reynolds',
  'Samuel L. Jackson', 'Sandra Bullock', 'Scarlett Johansson',
  'Sylvester Stallone', 'Tom Cruise', 'Tom Hanks', 'Will Smith',
  'Angelina Jolie', 'Bill Murray', 'George Clooney', 'Jennifer Lawrence',
  'Julia Roberts',
  // British actors
  'Daniel Craig', 'Emma Watson', 'Helen Mirren', 'Hugh Grant',
  'Idris Elba', 'Judi Dench', 'Kate Winslet', 'Benedict Cumberbatch',
  'Patrick Stewart', 'Rowan Atkinson', 'Sean Connery', 'Tom Hardy',
  // Canadian actors
  'Ryan Gosling', 'Seth Rogen', 'Mike Myers',
  'Rachel McAdams', 'Sandra Oh',
  // Singers
  'Beyoncé', 'Taylor Swift', 'Elvis Presley', 'Freddie Mercury',
  'Adele', 'Drake (musician)', 'Ed Sheeran', 'Elton John',
  'Rihanna', 'Lady Gaga', 'Michael Jackson', 'Madonna',
  'Bruno Mars', 'Celine Dion', 'Justin Bieber', 'The Weeknd',
  'David Bowie', 'Whitney Houston', 'Dolly Parton', 'Shania Twain',
  // Athletes
  'Michael Jordan', 'Serena Williams', 'LeBron James', 'Tom Brady',
  'Wayne Gretzky', 'David Beckham', 'Usain Bolt', 'Muhammad Ali',
  'Tiger Woods', 'Lionel Messi', 'Cristiano Ronaldo', 'Connor McDavid',
  'Sidney Crosby', 'Lewis Hamilton', 'Roger Federer',
];

const UNIQUE_AVATARS = [...new Set(AVATARS)];

function displayName(name) {
  return name.replace(/ \(.*\)$/, '');
}

function useAvatarPhotos() {
  const [photos, setPhotos] = useState({});

  useEffect(() => {
    const batches = [];
    for (let i = 0; i < UNIQUE_AVATARS.length; i += 50) {
      batches.push(UNIQUE_AVATARS.slice(i, i + 50));
    }

    Promise.all(
      batches.map((batch) => {
        const titles = batch.map((n) => n.replace(/ /g, '_')).join('|');
        const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles)}&prop=pageimages&pithumbsize=150&format=json&origin=*`;
        return fetch(url).then((r) => r.json());
      })
    )
      .then((results) => {
        const map = {};
        for (const data of results) {
          for (const page of Object.values(data.query.pages)) {
            if (page.thumbnail) {
              map[page.title] = page.thumbnail.source;
            }
          }
        }
        setPhotos((prev) => ({ ...prev, ...map }));
      })
      .catch(() => {});
  }, []);

  return [photos, setPhotos];
}

function fetchWikiPhoto(name) {
  const title = name.replace(/ /g, '_');
  const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&redirects=1&pithumbsize=150&format=json&origin=*`;
  return fetch(url)
    .then((r) => r.json())
    .then((data) => {
      for (const page of Object.values(data.query.pages)) {
        if (page.thumbnail) return { title: page.title, url: page.thumbnail.source };
      }
      return null;
    });
}

export default function AvatarPicker({ onDone }) {
  const { user, setUser } = useAuth();
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [customName, setCustomName] = useState('Celebrity Full Name');
  const [customCelebs, setCustomCelebs] = useState([]);
  const [customLoading, setCustomLoading] = useState(false);
  const [scrollTo, setScrollTo] = useState(null);
  const gridRef = useRef(null);
  const [photos, setPhotos] = useAvatarPhotos();

  useEffect(() => {
    api.get('/api/auth/avatars').then((data) => {
      const extra = {};
      for (const a of data.avatars) {
        extra[a.name] = a.photo_url;
      }
      setPhotos((prev) => ({ ...prev, ...extra }));
      setCustomCelebs(data.avatars.map((a) => a.name));
    }).catch(() => {});
  }, []);

  const handleCustom = async () => {
    const raw = customName.trim();
    const name = raw.replace(/\b\w/g, (c) => c.toUpperCase());
    if (!name || name === 'Celebrity Full Name') {
      setError('Enter a celebrity name first');
      return;
    }
    if (UNIQUE_AVATARS.includes(name) || customCelebs.includes(name)) {
      setError('That celebrity is already in the list');
      return;
    }
    setCustomLoading(true);
    setError('');
    try {
      const result = await fetchWikiPhoto(name);
      if (!result) {
        setError(`No photo found for "${name}" on Wikipedia`);
        setCustomLoading(false);
        return;
      }
      setPhotos((prev) => ({ ...prev, [result.title]: result.url, [name]: result.url }));
      await api.post('/api/auth/avatars', { name, photo_url: result.url });
      setCustomCelebs((prev) => [...prev, name]);
      setSelected(name);
      setScrollTo(name);
      setCustomName('Celebrity Full Name');
    } catch {
      setError('Failed to fetch photo from Wikipedia');
    }
    setCustomLoading(false);
  };

  useEffect(() => {
    if (!scrollTo || !gridRef.current) return;
    const el = gridRef.current.querySelector(`[data-celeb="${CSS.escape(scrollTo)}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setScrollTo(null);
  }, [scrollTo, customCelebs]);

  const handleSave = async () => {
    if (!selected) return;
    const avatarUrl = photos[selected] || '';
    if (!avatarUrl) {
      setError('Photo not loaded yet, please wait a moment');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const data = await api.put('/api/auth/avatar', { avatar: avatarUrl });
      setUser(data.user);
      if (onDone) onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.container}>
      <h2>Choose Your Avatar</h2>
      <p>Pick a celebrity avatar, {user.name}!</p>
      <div className={styles.grid} ref={gridRef}>
        {[...UNIQUE_AVATARS, ...customCelebs].map((celeb) => {
          const photoUrl = photos[celeb];
          const display = displayName(celeb);
          return (
            <button
              type="button"
              key={celeb}
              data-celeb={celeb}
              className={`${styles.item} ${selected === celeb ? styles.selected : ''}`}
              onClick={() => setSelected(celeb)}
              title={display}
            >
              {photoUrl ? (
                <img src={photoUrl} alt={display} className={styles.img} />
              ) : (
                <div className={`${styles.img} ${styles.placeholder}`}>
                  {display[0]}
                </div>
              )}
              <span className={styles.name}>{display.split(' ')[0]}</span>
            </button>
          );
        })}
      </div>
      <button
        onClick={handleSave}
        disabled={saving || !selected}
        className={styles.button}
      >
        {saving ? 'Saving...' : 'Save Avatar'}
      </button>
      <div className={styles.customLabel}>Think these Avatars are all lame, you can search for a new one:</div>
      <div className={styles.customRow}>
        <input
          className={styles.customInput}
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          onFocus={() => { if (customName === 'Celebrity Full Name') setCustomName(''); }}
          onBlur={() => { if (!customName.trim()) setCustomName('Celebrity Full Name'); }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCustom(); }}
        />
        <button
          type="button"
          className={styles.lameBtn}
          onClick={handleCustom}
          disabled={customLoading}
        >
          {customLoading ? 'Looking up...' : 'Search'}
        </button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      {onDone && user.avatar && (
        <button onClick={onDone} className={styles.cancelBtn}>
          Cancel
        </button>
      )}
    </div>
  );
}
