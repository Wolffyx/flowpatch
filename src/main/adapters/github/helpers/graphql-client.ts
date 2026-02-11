/**
 * GitHub GraphQL Client
 * Provides GraphQL query execution with pagination support
 */

import type { GithubCLIWrapper } from './cli-wrapper'

/**
 * Generic GraphQL client for GitHub API
 * Handles query execution, pagination, and error handling
 */
export class GithubGraphQLClient {
  constructor(private cli: GithubCLIWrapper) {}

  /**
   * Execute a GraphQL query
   */
  async query<T>(
    query: string,
    variables: Record<string, string | undefined | null>
  ): Promise<T> {
    return this.cli.apiGraphql<T>(query, variables)
  }

  /**
   * Execute a paginated GraphQL query
   * Automatically handles pagination until all results are fetched
   * 
   * @param query - GraphQL query with $after variable for pagination
   * @param baseVariables - Base variables for the query
   * @param extractor - Function to extract items and pageInfo from response
   * @param maxPages - Maximum number of pages to fetch (default: 200)
   */
  async paginatedQuery<TItem>(
    query: string,
    baseVariables: Record<string, string | undefined | null>,
    extractor: (response: any) => {
      items: TItem[]
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
    },
    maxPages = 200
  ): Promise<TItem[]> {
    const allItems: TItem[] = []
    let after: string | null = null
    let page = 0

    while (page < maxPages) {
      const variables = { ...baseVariables, after: after ?? undefined }
      const response = await this.query<any>(query, variables)

      if (response.errors?.length) {
        console.error('GraphQL errors:', response.errors)
        break
      }

      const { items, pageInfo } = extractor(response)
      allItems.push(...items)

      if (!pageInfo.hasNextPage || !pageInfo.endCursor) break
      after = pageInfo.endCursor
      page++
    }

    return allItems
  }

  /**
   * Find a single item matching a predicate using pagination
   * Stops as soon as the item is found
   */
  async findOne<TItem>(
    query: string,
    baseVariables: Record<string, string | undefined | null>,
    extractor: (response: any) => {
      items: TItem[]
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
    },
    predicate: (item: TItem) => boolean,
    maxPages = 200
  ): Promise<TItem | null> {
    let after: string | null = null
    let page = 0

    while (page < maxPages) {
      const variables = { ...baseVariables, after: after ?? undefined }
      const response = await this.query<any>(query, variables)

      if (response.errors?.length) {
        console.error('GraphQL errors:', response.errors)
        return null
      }

      const { items, pageInfo } = extractor(response)
      const found = items.find(predicate)
      if (found) return found

      if (!pageInfo.hasNextPage || !pageInfo.endCursor) break
      after = pageInfo.endCursor
      page++
    }

    return null
  }
}
