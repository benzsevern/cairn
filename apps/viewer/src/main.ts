// Dev entry — loads a fixture so we can iterate on rendering.
import { renderGraph } from './render.js';

const res = await fetch('/fixtures/empty.json');
const graph = await res.json();
renderGraph(graph);
