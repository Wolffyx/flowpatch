/**
 * GitHub Projects V2 GraphQL Types
 * Type definitions for GitHub Projects V2 API responses
 */

export interface ProjectV2Item {
  id: string
  content: {
    __typename: string
    number?: number
    url?: string
    id?: string
    title?: string
    body?: string | null
    updatedAt?: string
  } | null
  fieldValues: {
    nodes: Array<{
      __typename: string
      name?: string
      field?: {
        name: string
      }
    }>
  }
}

export interface ProjectV2Response {
  data?: {
    node?: {
      items?: {
        nodes: ProjectV2Item[]
        pageInfo: {
          hasNextPage: boolean
          endCursor: string | null
        }
      }
    }
  }
  errors?: Array<{ message: string }>
}

/**
 * Map of issue/PR number to their project status
 */
export type ProjectStatusMap = Map<number, string>
