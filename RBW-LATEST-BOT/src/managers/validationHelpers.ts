export function validatePositiveInt(value: any, name: string): number {
  if (typeof value !== 'number' || value <= 0 || !Number.isInteger(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function validatePageLimit(page: any, limit: any): { page: number; limit: number } {
  return {
    page: validatePositiveInt(page, 'Page'),
    limit: validatePositiveInt(limit, 'Limit')
  };
}

export function computePagination(page: number, limit: number, total: number) {
  const skip = (page - 1) * limit;
  const totalPages = Math.ceil(total / limit);
  return { skip, totalPages };
}
