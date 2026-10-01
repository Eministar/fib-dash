import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GraphBuilder, layoutGraph, nodeKey, parseNodeKey, type GraphNode } from '../src/lib/link-graph'

const node = (kind: GraphNode['kind'], id: string, depth = 1): GraphNode => ({
  key: nodeKey(kind, id),
  kind,
  id,
  label: id,
  code: id.toUpperCase(),
  flags: [],
  depth,
})

test('Fokus-Schlüssel werden streng geprüft', () => {
  assert.deepEqual(parseNodeKey('person:abc'), { kind: 'person', id: 'abc' })
  assert.equal(parseNodeKey('agent:abc'), null)
  assert.equal(parseNodeKey('person:'), null)
  assert.equal(parseNodeKey(':abc'), null)
  assert.equal(parseNodeKey(null), null)
})

test('Knotenlimit: Graph wird gekürzt, Kanten zu fehlenden Knoten fallen weg', () => {
  const builder = new GraphBuilder('investigation:a', 2)
  assert.equal(builder.addNode(node('investigation', 'a', 0)), true)
  assert.equal(builder.addNode(node('person', 'p1')), true)
  assert.equal(builder.addNode(node('person', 'p1')), false, 'doppelt')
  assert.equal(builder.addNode(node('person', 'p2')), false, 'über dem Limit')
  builder.addEdge('investigation:a', 'person:p1', 'involved', 'Zeuge')
  builder.addEdge('investigation:a', 'person:p2', 'involved', 'Zeuge')
  const graph = builder.build()
  assert.equal(graph.truncated, true)
  assert.deepEqual(graph.nodes.map((n) => n.key), ['investigation:a', 'person:p1'])
  assert.equal(graph.edges.length, 1)
})

test('Kanten sind ungerichtet eindeutig, Schleifen werden ignoriert', () => {
  const builder = new GraphBuilder('person:a')
  builder.addNode(node('person', 'a', 0))
  builder.addNode(node('person', 'b'))
  builder.addEdge('person:a', 'person:b', 'person-link', 'Familie')
  builder.addEdge('person:b', 'person:a', 'person-link', 'Familie')
  builder.addEdge('person:a', 'person:b', 'person-link', 'Partner')
  builder.addEdge('person:a', 'person:a', 'person-link', 'Familie')
  assert.equal(builder.build().edges.length, 2)
})

test('Layout ist deterministisch, Fokus bleibt in der Mitte, alle Knoten im Bild', () => {
  const builder = new GraphBuilder('investigation:a')
  builder.addNode(node('investigation', 'a', 0))
  for (let i = 0; i < 12; i += 1) {
    builder.addNode(node('person', `p${i}`))
    builder.addEdge('investigation:a', `person:p${i}`, 'involved')
  }
  const graph = builder.build()
  const first = layoutGraph(graph, { width: 800, height: 600, iterations: 120 })
  const second = layoutGraph(graph, { width: 800, height: 600, iterations: 120 })
  assert.deepEqual(first, second)
  assert.deepEqual(first['investigation:a'], { x: 400, y: 300 })
  for (const point of Object.values(first)) {
    assert.ok(point.x >= 20 && point.x <= 780 && point.y >= 20 && point.y <= 580)
  }
  const distinct = new Set(Object.values(first).map((p) => `${Math.round(p.x)}:${Math.round(p.y)}`))
  assert.equal(distinct.size, graph.nodes.length, 'keine Knoten übereinander')
})
