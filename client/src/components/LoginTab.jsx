import { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import styles from './LoginTab.module.css';

const AVATARS = [
  'Arnold Schwarzenegger', 'Brad Pitt', 'Bruce Willis', 'Cate Blanchett',
  'Charlie Chaplin', 'Chris Pratt', 'Clint Eastwood', 'Danny DeVito',
  'Denzel Washington', 'Dwayne Johnson', 'Eddie Murphy', 'Emma Stone',
  'Harrison Ford', 'Jack Nicholson', 'Jackie Chan', 'Jeff Goldblum',
  'Jim Carrey', 'Johnny Depp', 'Keanu Reeves', 'Leonardo DiCaprio',
  'Margot Robbie', 'Meryl Streep', 'Morgan Freeman', 'Nicolas Cage',
  'Oprah Winfrey', 'Robert De Niro', 'Robert Downey Jr.', 'Robin Williams',
  'Ryan Reynolds', 'Samuel L. Jackson', 'Sandra Bullock', 'Scarlett Johansson',
  'Sean Connery', 'Sigourney Weaver', 'Sylvester Stallone', 'Tom Cruise',
  'Tom Hanks', 'Uma Thurman', 'Vin Diesel', 'Will Smith',
  'Angelina Jolie', 'Ben Stiller', 'Bill Murray', 'Christopher Walken',
  'Drew Barrymore', 'George Clooney', 'Jennifer Lawrence', 'Julia Roberts',
  'Mark Wahlberg', 'Whoopi Goldberg',
];

function useAvatarPhotos() {
  const [photos, setPhotos] = useState({});

  useEffect(() => {
    const titles = AVATARS.map((n) => n.replace(/ /g, '_')).join('|');
    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles)}&prop=pageimages&pithumbsize=150&format=json&origin=*`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        const map = {};
        for (const page of Object.values(data.query.pages)) {
          if (page.thumbnail) {
            const name = page.title;
            map[name] = page.thumbnail.source;
          }
        }
        setPhotos(map);
      })
      .catch(() => {});
  }, []);

  return photos;
}

export default function LoginTab() {
  const { setUser } = useAuth();
  const [name, setName] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const photos = useAvatarPhotos();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedAvatar) {
      setError('Please select an avatar');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const avatarUrl = photos[selectedAvatar] || '';
      const data = await api.post('/api/auth/login', { name, avatar: avatarUrl });
      setUser(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <h2>Welcome</h2>
      <p>Enter your name and pick an avatar.</p>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={100}
          required
          className={styles.input}
        />
        <div className={styles.avatarSection}>
          <p className={styles.avatarLabel}>Choose your avatar:</p>
          <div className={styles.avatarGrid}>
            {AVATARS.map((celeb) => {
              const photoUrl = photos[celeb];
              return (
                <button
                  type="button"
                  key={celeb}
                  className={`${styles.avatarItem} ${selectedAvatar === celeb ? styles.avatarSelected : ''}`}
                  onClick={() => setSelectedAvatar(celeb)}
                  title={celeb}
                >
                  {photoUrl ? (
                    <img src={photoUrl} alt={celeb} className={styles.avatarImg} />
                  ) : (
                    <div className={`${styles.avatarImg} ${styles.avatarPlaceholder}`}>
                      {celeb[0]}
                    </div>
                  )}
                  <span className={styles.avatarName}>{celeb.split(' ')[0]}</span>
                </button>
              );
            })}
          </div>
        </div>
        {error && <p className={styles.error}>{error}</p>}
        <button type="submit" disabled={loading || !selectedAvatar} className={styles.button}>
          {loading ? 'Entering...' : 'Enter'}
        </button>
      </form>
    </div>
  );
}
