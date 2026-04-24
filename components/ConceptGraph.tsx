import { useMemo, useState, useCallback } from "react"
import { CrossDocAnalysis, KnowledgeDocument } from "../lib/types"

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return hash
}

function seededRandom(seed: string): number {
  const h = hashString(seed)
  const x = Math.sin(h) * 10000
  return x - Math.floor(x)
}

interface ConceptGraphProps {
  analysis: CrossDocAnalysis
  docs: KnowledgeDocument[]
  onDocClick?: (pageKey: string) => void
}

interface GraphNode {
  id: string
  label: string
  type: "doc" | "concept"
  pageKey?: string
  x: number
  y: number
}

interface GraphEdge {
  source: string
  target: string
  relationType: "shared" | "complementary" | "dependency"
  label?: string
}

const RELATION_COLORS: Record<string, { stroke: string; label: string }> = {
  shared: { stroke: "#3b82f6", label: "共同" },
  complementary: { stroke: "#8b5cf6", label: "互补" },
  dependency: { stroke: "#f59e0b", label: "依赖" },
}

const DOC_COLORS = [
  "#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4",
]

function layoutGraph(
  docs: KnowledgeDocument[],
  analysis: CrossDocAnalysis,
  width: number,
  height: number
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const nodeMap = new Map<string, GraphNode>()

  const docCount = docs.length
  const centerX = width / 2
  const centerY = height / 2
  const docRadius = Math.min(width, height) * 0.3

  docs.forEach((doc, i) => {
    const angle = (2 * Math.PI * i) / docCount - Math.PI / 2
    const x = centerX + docRadius * Math.cos(angle)
    const y = centerY + docRadius * Math.sin(angle)
    const node: GraphNode = {
      id: doc.pageKey,
      label: doc.pageTitle.length > 8 ? doc.pageTitle.slice(0, 8) + "…" : doc.pageTitle,
      type: "doc",
      pageKey: doc.pageKey,
      x,
      y,
    }
    nodes.push(node)
    nodeMap.set(doc.pageKey, node)
  })

  const conceptPositions = new Map<string, { x: number; y: number }>()

  for (const rel of analysis.relations) {
    const relatedDocNodes = rel.docPageKeys
      .map((pk) => nodeMap.get(pk))
      .filter(Boolean) as GraphNode[]

    if (relatedDocNodes.length < 1) continue

    if (!nodeMap.has(rel.conceptName)) {
      let cx: number, cy: number
      if (relatedDocNodes.length >= 2) {
        cx = relatedDocNodes.reduce((s, n) => s + n.x, 0) / relatedDocNodes.length
        cy = relatedDocNodes.reduce((s, n) => s + n.y, 0) / relatedDocNodes.length
        const jitter = 20
        cx += (seededRandom(rel.conceptName + "x") - 0.5) * jitter
        cy += (seededRandom(rel.conceptName + "y") - 0.5) * jitter
      } else {
        const angle = seededRandom(rel.conceptName + "a") * Math.PI * 2
        cx = relatedDocNodes[0].x + 60 * Math.cos(angle)
        cy = relatedDocNodes[0].y + 60 * Math.sin(angle)
      }

      const conceptNode: GraphNode = {
        id: rel.conceptName,
        label: rel.conceptName.length > 6 ? rel.conceptName.slice(0, 6) + "…" : rel.conceptName,
        type: "concept",
        x: cx,
        y: cy,
      }
      nodes.push(conceptNode)
      nodeMap.set(rel.conceptName, conceptNode)
      conceptPositions.set(rel.conceptName, { x: cx, y: cy })
    }

    for (const pk of rel.docPageKeys) {
      const docNode = nodeMap.get(pk)
      if (docNode && !edges.some((e) =>
        e.source === pk && e.target === rel.conceptName && e.relationType === rel.relationType
      )) {
        edges.push({
          source: pk,
          target: rel.conceptName,
          relationType: rel.relationType,
        })
      }
    }
  }

  return { nodes, edges }
}

export const ConceptGraph = ({
  analysis,
  docs,
  onDocClick,
}: ConceptGraphProps) => {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [dimensions, setDimensions] = useState({ width: 360, height: 300 })

  const { nodes, edges } = useMemo(
    () => layoutGraph(docs, analysis, dimensions.width, dimensions.height),
    [docs, analysis, dimensions]
  )

  const handleNodeHover = useCallback((id: string | null) => {
    setHoveredNode(id)
  }, [])

  const connectedNodes = useMemo(() => {
    if (!hoveredNode) return new Set<string>()
    const connected = new Set<string>([hoveredNode])
    for (const edge of edges) {
      if (edge.source === hoveredNode) connected.add(edge.target)
      if (edge.target === hoveredNode) connected.add(edge.source)
    }
    return connected
  }, [hoveredNode, edges])

  const docColorMap = useMemo(() => {
    const map = new Map<string, string>()
    docs.forEach((doc, i) => {
      map.set(doc.pageKey, DOC_COLORS[i % DOC_COLORS.length])
    })
    return map
  }, [docs])

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
        className="w-full h-auto bg-notion-bg-secondary rounded-xl border border-notion-border/30"
        style={{ minHeight: 200 }}
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" fill="#94a3b8" />
          </marker>
        </defs>

        {edges.map((edge, i) => {
          const sourceNode = nodes.find((n) => n.id === edge.source)
          const targetNode = nodes.find((n) => n.id === edge.target)
          if (!sourceNode || !targetNode) return null

          const isHighlighted = hoveredNode && (connectedNodes.has(edge.source) || connectedNodes.has(edge.target))
          const opacity = hoveredNode ? (isHighlighted ? 1 : 0.15) : 0.6
          const color = RELATION_COLORS[edge.relationType]?.stroke || "#94a3b8"

          const dx = targetNode.x - sourceNode.x
          const dy = targetNode.y - sourceNode.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          const offset = edge.source.startsWith("doc-") || docs.some(d => d.pageKey === edge.source) ? 24 : 16
          const targetOffset = edge.target.startsWith("doc-") || docs.some(d => d.pageKey === edge.target) ? 24 : 16
          const sx = sourceNode.x + (dx / dist) * offset
          const sy = sourceNode.y + (dy / dist) * offset
          const ex = targetNode.x - (dx / dist) * targetOffset
          const ey = targetNode.y - (dy / dist) * targetOffset

          return (
            <line
              key={`edge-${i}`}
              x1={sx}
              y1={sy}
              x2={ex}
              y2={ey}
              stroke={color}
              strokeWidth={isHighlighted ? 2.5 : 1.5}
              opacity={opacity}
              markerEnd={edge.relationType === "dependency" ? "url(#arrowhead)" : undefined}
              strokeDasharray={edge.relationType === "complementary" ? "4,4" : undefined}
            />
          )
        })}

        {nodes.map((node) => {
          const isDoc = node.type === "doc"
          const isHighlighted = !hoveredNode || connectedNodes.has(node.id)
          const opacity = hoveredNode ? (isHighlighted ? 1 : 0.2) : 1
          const color = isDoc
            ? docColorMap.get(node.id) || "#6b7280"
            : "#6b7280"
          const r = isDoc ? 22 : 14

          return (
            <g
              key={node.id}
              opacity={opacity}
              onMouseEnter={() => handleNodeHover(node.id)}
              onMouseLeave={() => handleNodeHover(null)}
              onClick={() => {
                if (isDoc && node.pageKey) {
                  onDocClick?.(node.pageKey)
                }
              }}
              style={{ cursor: isDoc ? "pointer" : "default" }}
            >
              <circle
                cx={node.x}
                cy={node.y}
                r={r}
                fill={isDoc ? color : "#f3f4f6"}
                stroke={isDoc ? color : "#d1d5db"}
                strokeWidth={isDoc ? 2 : 1.5}
              />
              {isDoc && (
                <svg
                  x={node.x - 6}
                  y={node.y - 6}
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth="2"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              )}
              {!isDoc && (
                <svg
                  x={node.x - 5}
                  y={node.y - 5}
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#6b7280"
                  strokeWidth="2"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              )}
              <text
                x={node.x}
                y={node.y + r + 12}
                textAnchor="middle"
                fill="#374151"
                fontSize={isDoc ? 10 : 9}
                fontWeight={isDoc ? 600 : 400}
              >
                {node.label}
              </text>
            </g>
          )
        })}
      </svg>

      <div className="flex items-center justify-center gap-4 mt-2">
        {Object.entries(RELATION_COLORS).map(([type, config]) => (
          <div key={type} className="flex items-center gap-1">
            <div
              className="w-4 h-0.5"
              style={{
                backgroundColor: config.stroke,
                borderStyle: type === "complementary" ? "dashed" : "solid",
              }}
            />
            <span className="text-[10px] text-notion-text-secondary">{config.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
