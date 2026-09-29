import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import type { JobDto } from '@haggler/shared';
import { submitReview } from '../../api/reputation';
import { Button, Card, Text, TextField } from '../../components';
import { errorMessage } from '../../lib/errors';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing } from '../../theme/tokens';

/** One row of five tappable stars. `value` is 0 (nothing chosen) to 5. */
function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          testID={`star-${n}`}
          accessibilityRole="button"
          accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}
          hitSlop={8}
          onPress={() => onChange(n)}
        >
          <Ionicons
            name={n <= value ? 'star' : 'star-outline'}
            size={32}
            color={n <= value ? colors.warning : colors.textMuted}
          />
        </Pressable>
      ))}
    </View>
  );
}

/** Shown to whichever party can still leave a review once the job is CONFIRMED_BY_CUSTOMER. */
export function ReviewPrompt({ job }: { job: JobDto }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);

  if (!job.review.canReview && !done) return null;
  if (done)
    return (
      <Text testID="review-thanks" color="success">
        {t('job.reviewThanks')}
      </Text>
    );

  async function submit() {
    if (rating === 0) return setError(t('job.reviewNeedsRating'));
    setBusy(true);
    setError(undefined);
    try {
      await submitReview(job.id, { rating, comment: comment.trim() || undefined });
      await qc.invalidateQueries({ queryKey: ['job', job.id] });
      await qc.invalidateQueries({ queryKey: ['job', job.id, 'reviews'] });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card testID="review-prompt">
      <View style={{ gap: spacing.md }}>
        <Text variant="heading">
          {job.viewerRole === 'WORKER' ? t('job.rateCustomer') : t('job.rateRanger')}
        </Text>
        <StarPicker value={rating} onChange={setRating} />
        <TextField
          testID="review-comment"
          label={t('job.reviewCommentLabel')}
          value={comment}
          onChangeText={setComment}
          maxLength={500}
          multiline
        />
        {error ? (
          <Text color="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button
          testID="submit-review"
          title={t('job.submitReview')}
          loading={busy}
          onPress={() => void submit()}
        />
      </View>
    </Card>
  );
}
