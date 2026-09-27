import { useParams } from 'react-router-dom';
import { BookcasePage } from './bookcase/BookcasePage';

/** Another reader's bookcase, opened from their profile. */
export function ReaderShelfPage() {
  const { userId } = useParams<{ userId: string }>();
  if (!userId) return null;
  // Keyed so moving from one reader's shelf to another's starts clean.
  return <BookcasePage key={userId} ownerId={userId} />;
}
