// Keep dependent database operations ordered, including within one transaction.
export async function mapSeries<T, R>(items: readonly T[], work: (item: T, index: number) => R | Promise<R>): Promise<R[]> {
    const result: R[] = [];
    for (const [index, item] of items.entries())
        result.push(await work(item, index));
    return result;
}
