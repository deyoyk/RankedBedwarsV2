export function validatePositiveInt(value: unknown, name: string): number {
  if (typeof value !== 'number' || value <= 0 || !Number.isInteger(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function validatePageLimit(page: unknown, limit: unknown): { page: number; limit: number } {
  return {
    page: validatePositiveInt(page, 'Page'),
    limit: validatePositiveInt(limit, 'Limit')
  };
}

export function computePagination(page: number, limit: number, total: number) {
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 10;
  const safeTotal = Number.isInteger(total) && total >= 0 ? total : 0;
  const skip = (safePage - 1) * safeLimit;
  const totalPages = safeTotal === 0 ? 0 : Math.ceil(safeTotal / safeLimit);
  return { skip, totalPages };
}
