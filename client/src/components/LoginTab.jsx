import { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import styles from './LoginTab.module.css';

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
  'Ryan Gosling', 'Seth Rogen', 'Mike Myers', 'Keanu Reeves',
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

// Deduplicate (Keanu Reeves appears in both American and Canadian)
const UNIQUE_AVATARS = [...new Set(AVATARS)];

// Display name (strip Wikipedia disambiguation)
function displayName(name) {
  return name.replace(/ \(.*\)$/, '');
}

function useAvatarPhotos() {
  const [photos, setPhotos] = useState({});

  useEffect(() => {
    // Wikipedia API supports max 50 titles per request
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
            {UNIQUE_AVATARS.map((celeb) => {
              const photoUrl = photos[celeb];
              const display = displayName(celeb);
              return (
                <button
                  type="button"
                  key={celeb}
                  className={`${styles.avatarItem} ${selectedAvatar === celeb ? styles.avatarSelected : ''}`}
                  onClick={() => setSelectedAvatar(celeb)}
                  title={display}
                >
                  {photoUrl ? (
                    <img src={photoUrl} alt={display} className={styles.avatarImg} />
                  ) : (
                    <div className={`${styles.avatarImg} ${styles.avatarPlaceholder}`}>
                      {display[0]}
                    </div>
                  )}
                  <span className={styles.avatarName}>{display.split(' ')[0]}</span>
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
