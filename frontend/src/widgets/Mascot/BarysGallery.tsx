import { Barys, type BarysMood, type BarysStage } from './Barys';

/** Every mood and stage side by side, for drawing him (dev only, /__barys). */
export function BarysGallery() {
  const moods: BarysMood[] = ['hungry', 'happy', 'celebrate', 'sad', 'sleep', 'reading'];
  const stages: BarysStage[] = [1, 2, 3];
  return (
    <div style={{ display: 'grid', gap: 18, padding: 20, background: 'var(--color-bg-primary)', minHeight: '100vh' }}>
      {stages.map((stage) => (
        <div key={stage} style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {moods.map((mood) => (
            <figure key={mood} style={{ margin: 0, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>
              <Barys mood={mood} stage={stage} size={150} />
              <figcaption>{mood} · {stage}</figcaption>
            </figure>
          ))}
        </div>
      ))}
    </div>
  );
}
