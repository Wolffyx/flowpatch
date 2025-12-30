import { useCallback, useEffect, useState, useMemo } from 'react'
import { toast } from 'sonner'
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  ConnectionMode,
  Panel,
  MarkerType,
  BackgroundVariant
} from 'reactflow'
import dagre from '@dagrejs/dagre'
import 'reactflow/dist/style.css'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { cn } from '../lib/utils'
import {
  Loader2,
  Network,
  LayoutGrid,
  Grid3X3,
  Maximize2,
  Minimize2,
  Eye,
  EyeOff
} from 'lucide-react'
import type { Card, CardStatus, CardDependency } from '../../../shared/types'

interface GraphViewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectCard?: (cardId: string) => void
}

const STATUS_COLORS: Record<CardStatus, { bg: string; border: string; text: string }> = {
  draft: { bg: '#6b7280', border: '#4b5563', text: '#ffffff' },
  ready: { bg: '#3b82f6', border: '#2563eb', text: '#ffffff' },
  in_progress: { bg: '#eab308', border: '#ca8a04', text: '#000000' },
  in_review: { bg: '#a855f7', border: '#9333ea', text: '#ffffff' },
  testing: { bg: '#f97316', border: '#ea580c', text: '#ffffff' },
  done: { bg: '#22c55e', border: '#16a34a', text: '#ffffff' }
}

const STATUS_LABELS: Record<CardStatus, string> = {
  draft: 'Draft',
  ready: 'Ready',
  in_progress: 'In Progress',
  in_review: 'In Review',
  testing: 'Testing',
  done: 'Done'
}

type LayoutType = 'dagre' | 'grid'

// Grid layout for cards without dependencies
const getGridLayout = (nodes: Node[], columns: number = 4): Node[] => {
  const nodeWidth = 220
  const nodeHeight = 80
  const gapX = 30
  const gapY = 30

  return nodes.map((node, index) => ({
    ...node,
    position: {
      x: (index % columns) * (nodeWidth + gapX),
      y: Math.floor(index / columns) * (nodeHeight + gapY)
    }
  }))
}

// Dagre layout algorithm for dependency graph
const getDagreLayout = (
  nodes: Node[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'TB'
): { nodes: Node[]; edges: Edge[] } => {
  if (nodes.length === 0) return { nodes: [], edges: [] }

  // If no edges, use grid layout
  if (edges.length === 0) {
    return { nodes: getGridLayout(nodes), edges }
  }

  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))

  const nodeWidth = 220
  const nodeHeight = 80

  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 60,
    ranksep: 100,
    marginx: 20,
    marginy: 20
  })

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight })
  })

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  dagre.layout(dagreGraph)

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id)
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2
      }
    }
  })

  return { nodes: layoutedNodes, edges }
}

// Custom node component
function CardNode({ data }: { data: { card: Card; selected: boolean } }) {
  const { card, selected } = data
  const colors = STATUS_COLORS[card.status]

  return (
    <div
      className={cn(
        'px-3 py-2 rounded-lg shadow-lg border-2 w-[200px] cursor-pointer transition-all hover:scale-105',
        selected && 'ring-2 ring-offset-2 ring-offset-background'
      )}
      style={{
        backgroundColor: colors.bg,
        borderColor: colors.border,
        color: colors.text,
        boxShadow: selected
          ? `0 0 0 2px ${colors.border}, 0 4px 12px rgba(0,0,0,0.3)`
          : '0 4px 8px rgba(0,0,0,0.2)'
      }}
    >
      <div className="text-[10px] uppercase tracking-wider opacity-80 mb-1 font-medium">
        {STATUS_LABELS[card.status]}
      </div>
      <div className="text-sm font-semibold truncate leading-tight">{card.title}</div>
      {card.remote_number_or_iid && (
        <div className="text-[10px] opacity-70 mt-1">#{card.remote_number_or_iid}</div>
      )}
    </div>
  )
}

const nodeTypes = {
  card: CardNode
}

export function GraphViewDialog({
  open,
  onOpenChange,
  onSelectCard
}: GraphViewDialogProps): React.JSX.Element {
  const [cards, setCards] = useState<Card[]>([])
  const [dependencies, setDependencies] = useState<CardDependency[]>([])
  const [loading, setLoading] = useState(true)
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [layoutType, setLayoutType] = useState<LayoutType>('dagre')
  const [showMinimap, setShowMinimap] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)

  // Load cards and dependencies
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // Load all cards
      const cardsData = await window.projectAPI.getCards()
      setCards(cardsData)

      // Load all dependencies for the project
      const depsResult = await window.projectAPI.getDependenciesByProject()
      if (depsResult.error) {
        toast.error('Failed to load dependencies', { description: depsResult.error })
        setDependencies([])
      } else {
        setDependencies(depsResult.dependencies)
      }
    } catch (err) {
      toast.error('Failed to load graph data', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
      setCards([])
      setDependencies([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      loadData()
    }
  }, [open, loadData])

  // Convert cards and dependencies to nodes and edges
  useEffect(() => {
    if (cards.length === 0) {
      setNodes([])
      setEdges([])
      return
    }

    // Create nodes from cards
    const initialNodes: Node[] = cards.map((card) => ({
      id: card.id,
      type: 'card',
      data: { card, selected: card.id === selectedCardId },
      position: { x: 0, y: 0 }
    }))

    // Create edges from dependencies (only active ones)
    const initialEdges: Edge[] = dependencies
      .filter((dep) => dep.is_active === 1)
      .map((dep) => ({
        id: dep.id,
        source: dep.depends_on_card_id,
        target: dep.card_id,
        type: 'smoothstep',
        animated: true,
        style: { stroke: '#94a3b8', strokeWidth: 2 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: '#94a3b8',
          width: 20,
          height: 20
        },
        label: `needs ${STATUS_LABELS[dep.required_status]}`,
        labelStyle: { fontSize: 11, fill: '#94a3b8', fontWeight: 500 },
        labelBgStyle: { fill: '#1e1e1e', fillOpacity: 0.9 },
        labelBgPadding: [4, 8] as [number, number],
        labelBgBorderRadius: 4
      }))

    // Apply layout
    if (layoutType === 'grid') {
      setNodes(getGridLayout(initialNodes))
      setEdges(initialEdges)
    } else {
      const { nodes: layoutedNodes, edges: layoutedEdges } = getDagreLayout(
        initialNodes,
        initialEdges
      )
      setNodes(layoutedNodes)
      setEdges(layoutedEdges)
    }
  }, [cards, dependencies, layoutType, selectedCardId, setNodes, setEdges])

  // Handle node click
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setSelectedCardId(node.id)
      if (onSelectCard) {
        onSelectCard(node.id)
      }
    },
    [onSelectCard]
  )

  // Stats
  const stats = useMemo(() => {
    const totalCards = cards.length
    const activeDeps = dependencies.filter((d) => d.is_active === 1)
    const totalDependencies = activeDeps.length
    const cardsWithDeps = new Set(activeDeps.map((d) => d.card_id)).size
    const blockedCards = cards.filter((c) =>
      activeDeps.some((d) => {
        if (d.card_id !== c.id) return false
        const depCard = cards.find((bc) => bc.id === d.depends_on_card_id)
        if (!depCard) return false
        // Check if the dependency card has reached the required status
        const statusOrder: CardStatus[] = [
          'draft',
          'ready',
          'in_progress',
          'in_review',
          'testing',
          'done'
        ]
        const currentIdx = statusOrder.indexOf(depCard.status)
        const requiredIdx = statusOrder.indexOf(d.required_status)
        return currentIdx < requiredIdx
      })
    ).length

    return { totalCards, totalDependencies, cardsWithDeps, blockedCards }
  }, [cards, dependencies])

  const dialogContent = (
    <div className={cn('flex flex-col', isFullscreen ? 'h-screen' : 'h-[70vh]')}>
      {/* Header Stats */}
      <div className="flex items-center gap-3 px-4 py-2 border-b bg-muted/30 flex-wrap">
        <Badge variant="outline" className="gap-1.5 font-medium">
          <Network className="h-3 w-3" />
          {stats.totalCards} Cards
        </Badge>
        <Badge variant="outline" className="gap-1.5 font-medium">
          {stats.totalDependencies} Dependencies
        </Badge>
        {stats.cardsWithDeps > 0 && (
          <Badge variant="secondary" className="gap-1.5 font-medium">
            {stats.cardsWithDeps} with deps
          </Badge>
        )}
        {stats.blockedCards > 0 && (
          <Badge variant="destructive" className="gap-1.5 font-medium">
            {stats.blockedCards} blocked
          </Badge>
        )}

        <div className="flex-1" />

        {/* Controls */}
        <div className="flex items-center gap-1">
          <Button
            variant={layoutType === 'dagre' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setLayoutType('dagre')}
            title="Hierarchical layout"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={layoutType === 'grid' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setLayoutType('grid')}
            title="Grid layout"
          >
            <Grid3X3 className="h-4 w-4" />
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowMinimap(!showMinimap)}
          title={showMinimap ? 'Hide minimap' : 'Show minimap'}
        >
          {showMinimap ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsFullscreen(!isFullscreen)}
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Graph Area */}
      <div className="flex-1 relative bg-[#1a1a1a]">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Loading graph...</span>
            </div>
          </div>
        ) : cards.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
            <Network className="h-16 w-16 mb-4 opacity-30" />
            <p className="text-lg font-medium">No cards to display</p>
            <p className="text-sm opacity-70">Create some cards to see them in the graph</p>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            connectionMode={ConnectionMode.Loose}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
            minZoom={0.1}
            maxZoom={2}
            attributionPosition="bottom-left"
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              color="#333"
              gap={20}
              size={1}
            />
            <Controls
              showInteractive={false}
              className="bg-background/80 border rounded-lg"
            />
            {showMinimap && (
              <MiniMap
                nodeStrokeWidth={3}
                zoomable
                pannable
                className="bg-background/80 border rounded-lg"
                maskColor="rgba(0,0,0,0.6)"
                nodeColor={(node) => {
                  const card = node.data?.card as Card | undefined
                  return card ? STATUS_COLORS[card.status].bg : '#666'
                }}
              />
            )}
            <Panel position="bottom-right" className="bg-background/90 p-3 rounded-lg border shadow-lg m-2">
              <div className="text-xs font-medium text-muted-foreground mb-2">Status Legend</div>
              <div className="grid grid-cols-3 gap-x-4 gap-y-1.5 text-xs">
                {Object.entries(STATUS_COLORS).map(([status, colors]) => (
                  <div key={status} className="flex items-center gap-1.5">
                    <div
                      className="w-3 h-3 rounded-sm border"
                      style={{ backgroundColor: colors.bg, borderColor: colors.border }}
                    />
                    <span className="text-muted-foreground">{STATUS_LABELS[status as CardStatus]}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </ReactFlow>
        )}
      </div>
    </div>
  )

  if (isFullscreen) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[100vw] w-screen h-screen p-0 m-0 rounded-none">
          <DialogHeader className="sr-only">
            <DialogTitle>Dependency Graph</DialogTitle>
            <DialogDescription>
              Visual representation of card dependencies
            </DialogDescription>
          </DialogHeader>
          {dialogContent}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[90vw] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Network className="h-5 w-5" />
            Dependency Graph
          </DialogTitle>
          <DialogDescription>
            Visual representation of card dependencies. Arrows point from dependency to
            dependent card.
          </DialogDescription>
        </DialogHeader>
        {dialogContent}
      </DialogContent>
    </Dialog>
  )
}
