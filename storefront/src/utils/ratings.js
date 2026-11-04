export function getRatingLabel(average) {
  if (average < 1) return 'Faible';
  if (average >= 1 && average < 3) return 'Moyen';
  if (average >= 3 && average < 4) return 'Bon';
  if (average >= 4) return 'Excellent';
  return 'Moyen';
}

export function calculateRatingSummary(reviews) {
  if (!reviews?.length) return null;

  const total = reviews.reduce((sum, r) => sum + (Number(r.rating) || 0), 0);
  const average = total / reviews.length;
  const label = getRatingLabel(average);

  return {
    average: Math.round(average * 10) / 10,
    label,
    count: reviews.length,
  };
}
