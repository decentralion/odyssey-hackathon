// @flow

import sortBy from "lodash.sortby";
import {
  Graph,
  NodeAddress,
  EdgeAddress,
  type NodeAddressT,
  type Edge,
  type EdgesOptions,
} from "./graph";
import {
  PagerankGraph,
  Direction,
  type PagerankSeedOptions,
  type PagerankParams,
} from "./pagerankGraph";
import {advancedGraph} from "./graphTestUtil";
import * as NullUtil from "../util/null";
import type {OrderedSparseMarkovChain} from "./attribution/graphToMarkovChain";
import {uniformDistribution} from "./attribution/markovChain";

describe("core/pagerankGraph", () => {
  const defaultEvaluator = (_unused_edge) => ({toWeight: 1, froWeight: 0});
  const nonEmptyGraph = () =>
    new Graph().addNode(NodeAddress.fromParts(["hi"]));

  function examplePagerankGraph(
    edgeEvaluator = defaultEvaluator
  ): PagerankGraph {
    const g = advancedGraph().graph1();
    return new PagerankGraph(g, edgeEvaluator);
  }
  const defaultSeed = () => ({type: "NO_SEED"});
  async function convergedPagerankGraph(
    seed: PagerankSeedOptions = defaultSeed()
  ): Promise<PagerankGraph> {
    const pg = examplePagerankGraph();
    await pg.runPagerank(seed, {
      maxIterations: 100,
      convergenceThreshold: 1e-4,
    });
    return pg;
  }

  it("cannot construct PagerankGraph with empty Graph", () => {
    const eg1 = new Graph();
    const eg2 = new Graph()
      .addNode(NodeAddress.empty)
      .removeNode(NodeAddress.empty);
    expect(() => new PagerankGraph(eg1, defaultEvaluator)).toThrowError(
      "empty graph"
    );
    expect(() => new PagerankGraph(eg2, defaultEvaluator)).toThrowError(
      "empty graph"
    );
  });

  describe("node / nodes", () => {
    it("node returns null for node not in the graph", () => {
      const g = nonEmptyGraph();
      const pg = new PagerankGraph(g, defaultEvaluator);
      expect(pg.node(NodeAddress.empty)).toEqual(null);
    });
    it("nodes yields the same nodes as are in the graph", () => {
      const g = advancedGraph().graph1();
      const pg = new PagerankGraph(g, defaultEvaluator);
      const graphNodes = Array.from(g.nodes());
      const pgNodes = Array.from(pg.nodes()).map((x) => x.node);
      expect(graphNodes.length).toEqual(pgNodes.length);
      expect(new Set(graphNodes)).toEqual(new Set(pgNodes));
    });
    it("node and nodes both return consistent scores", async () => {
      const pg = await convergedPagerankGraph();
      for (const {node, score} of pg.nodes()) {
        expect(score).toEqual(NullUtil.get(pg.node(node)).score);
      }
    });
    it("node and nodes both throw an error if underlying graph is modified", () => {
      const pg = new PagerankGraph(nonEmptyGraph(), defaultEvaluator);
      pg.graph().addNode(NodeAddress.empty);
      expect(() => pg.nodes()).toThrowError(
        "underlying Graph has been modified"
      );
      expect(() => pg.node(NodeAddress.empty)).toThrowError(
        "underlying Graph has been modified"
      );
    });
  });

  describe("node prefix filter matches graph filter", () => {
    const n1 = NodeAddress.empty;
    const n2 = NodeAddress.fromParts(["foo"]);
    const n3 = NodeAddress.fromParts(["foo", "bar"]);
    const n4 = NodeAddress.fromParts(["zod", "bar"]);
    const g = () =>
      new Graph()
        .addNode(n1)
        .addNode(n2)
        .addNode(n3)
        .addNode(n4);
    const pg = () => new PagerankGraph(g(), defaultEvaluator);

    function expectPagerankGraphToEqualGraph(
      options: {|+prefix: NodeAddressT|} | void
    ) {
      const pagerankGraphNodes = Array.from(pg().nodes(options)).sort();
      const graphNodes = Array.from(g().nodes(options)).sort();

      pagerankGraphNodes.forEach(
        (pgNode, i) =>
          expect(pgNode.node).toEqual(graphNodes[i]) &&
          expect(pgNode.score).toBe(0.25)
      );
    }

    it("with no options object", () => {
      expectPagerankGraphToEqualGraph(undefined);
    });

    it("with prefix filter", () => {
      expectPagerankGraphToEqualGraph({prefix: n2});
    });

    it("with empty prefix", () => {
      expectPagerankGraphToEqualGraph({prefix: NodeAddress.empty});
    });

    it("with prefix that matches nothing", () => {
      expectPagerankGraphToEqualGraph({prefix: NodeAddress.fromParts(["2"])});
    });
  });

  describe("node prefix filter", () => {
    it("requires a prefix when options are specified", () => {
      const pg = new PagerankGraph(nonEmptyGraph(), defaultEvaluator);
      // $ExpectFlowError
      expect(() => pg.nodes({})).toThrow("prefix");
    });
  });

  describe("edge/edges", () => {
    it("edges returns the same edges as are in the graph", () => {
      const g = advancedGraph().graph1();
      const pg = new PagerankGraph(g, defaultEvaluator);
      const graphEdges = Array.from(g.edges());
      const pgEdges = Array.from(pg.edges()).map((x) => x.edge);
      expect(graphEdges.length).toEqual(pgEdges.length);
      const addressAccessor = (x: Edge) => x.address;
      const sortedGraphEdges = sortBy(graphEdges, addressAccessor);
      const sortedPagerankEdges = sortBy(pgEdges, addressAccessor);
      expect(sortedGraphEdges).toEqual(sortedPagerankEdges);
    });

    it("edge/edges both correctly return the edge weights", () => {
      const edgeEvaluator = ({address, src, dst}) => {
        return {
          toWeight: address.length + src.length,
          froWeight: address.length + dst.length,
        };
      };
      const g = advancedGraph().graph1();
      const pg = new PagerankGraph(g, edgeEvaluator);
      for (const {edge, weight} of pg.edges()) {
        expect(edgeEvaluator(edge)).toEqual(weight);
        expect(NullUtil.get(pg.edge(edge.address)).weight).toEqual(weight);
      }
    });

    it("edge returns null for address not in the graph", () => {
      const pg = new PagerankGraph(nonEmptyGraph(), defaultEvaluator);
      expect(pg.edge(EdgeAddress.empty)).toEqual(null);
    });

    it("edge and edges both throw an error if underlying graph is modified", () => {
      const pg = new PagerankGraph(nonEmptyGraph(), defaultEvaluator);
      pg.graph().addNode(NodeAddress.empty);
      expect(() => pg.edges()).toThrowError(
        "underlying Graph has been modified"
      );
      expect(() => pg.edge(EdgeAddress.empty)).toThrowError(
        "underlying Graph has been modified"
      );
    });
  });

  describe("totalOutWeight", () => {
    it("errors on a modified graph", () => {
      const eg = examplePagerankGraph();
      eg.graph().addNode(NodeAddress.fromParts(["bad", "node"]));
      expect(() =>
        eg.totalOutWeight(NodeAddress.fromParts(["bad", "node"]))
      ).toThrowError("has been modified");
    });
    it("errors on nonexistent node", () => {
      const eg = examplePagerankGraph();
      expect(() =>
        eg.totalOutWeight(NodeAddress.fromParts(["nonexistent"]))
      ).toThrowError("non-existent node");
    });
    function verifyOutWeights(pg: PagerankGraph) {
      const outWeight: Map<NodeAddressT, number> = new Map();
      for (const node of pg.graph().nodes()) {
        outWeight.set(node, pg.syntheticLoopWeight());
      }
      const addOutWeight = (node: NodeAddressT, weight: number) => {
        const previousWeight = NullUtil.get(outWeight.get(node));
        const newWeight = previousWeight + weight;
        outWeight.set(node, newWeight);
      };
      for (const {edge, weight} of pg.edges()) {
        addOutWeight(edge.src, weight.toWeight);
        addOutWeight(edge.dst, weight.froWeight);
      }
      for (const node of pg.graph().nodes()) {
        expect(pg.totalOutWeight(node)).toEqual(outWeight.get(node));
      }
    }
    it("computes outWeight correctly on the example graph", () => {
      const edgeEvaluator = (_unused_edge) => ({toWeight: 1, froWeight: 2});
      const eg = examplePagerankGraph(edgeEvaluator);
      verifyOutWeights(eg);
    });
    it("outWeight is always the syntheticLoopWeight when edges have no weight", () => {
      const zeroEvaluator = (_unused_edge) => ({toWeight: 0, froWeight: 0});
      const syntheticLoopWeight = 0.1337;
      const pg = new PagerankGraph(
        advancedGraph().graph1(),
        zeroEvaluator,
        syntheticLoopWeight
      );
      for (const {node} of pg.nodes()) {
        expect(pg.totalOutWeight(node)).toEqual(syntheticLoopWeight);
      }
    });
    it("outWeight is computed correctly after JSON deserialization", () => {
      // I added this test because the outWeight map is a cache that is computed
      // once, in the constructor, and since the JSON deserialization invokes
      // the constructor and then hacks variables around a bit, I want to ensure the
      // outWeight cache is still generated properly.
      const eg = examplePagerankGraph();
      const eg_ = PagerankGraph.fromJSON(eg.toJSON());
      verifyOutWeights(eg_);
    });
  });

  describe("edge filtering", () => {
    const src1 = NodeAddress.fromParts(["src", "1"]);
    const src2 = NodeAddress.fromParts(["src", "2"]);
    const dst1 = NodeAddress.fromParts(["dst", "1"]);
    const dst2 = NodeAddress.fromParts(["dst", "2"]);
    const e11 = {
      src: src1,
      dst: dst1,
      address: EdgeAddress.fromParts(["e", "1", "1"]),
    };
    const e12 = {
      src: src1,
      dst: dst2,
      address: EdgeAddress.fromParts(["e", "1", "2"]),
    };
    const e21 = {
      src: src2,
      dst: dst1,
      address: EdgeAddress.fromParts(["e", "2", "1"]),
    };
    const e22 = {
      src: src2,
      dst: dst2,
      address: EdgeAddress.fromParts(["e", "2", "2"]),
    };
    const graph = () => {
      const g = new Graph();
      [src1, src2, dst1, dst2].forEach((n) => g.addNode(n));
      [e11, e12, e21, e22].forEach((e) => g.addEdge(e));
      return g;
    };
    const pagerankGraph = () => new PagerankGraph(graph(), defaultEvaluator);

    function expectConsistentEdges(options: EdgesOptions | void) {
      const pagerankGraphEdges = Array.from(pagerankGraph().edges(options));
      pagerankGraphEdges.forEach((e) => {
        expect(e.weight.froWeight).toBe(0);
        expect(e.weight.toWeight).toBe(1);
      });
      const graphEdges = Array.from(graph().edges(options));
      expect(pagerankGraphEdges.map((e) => e.edge)).toEqual(graphEdges);
    }

    describe("edge filter matches graph edge filter", () => {
      it("finds all edges when no options are specified", () => {
        expectConsistentEdges(undefined);
      });
      it("finds all edges when all-inclusive filters are specified", () => {
        expectConsistentEdges({
          addressPrefix: EdgeAddress.fromParts(["e"]),
          srcPrefix: NodeAddress.fromParts(["src"]),
          dstPrefix: NodeAddress.fromParts(["dst"]),
        });
      });
      it("finds edges by address prefix", () => {
        expectConsistentEdges({
          addressPrefix: EdgeAddress.fromParts(["e", "1"]),
          srcPrefix: NodeAddress.empty,
          dstPrefix: NodeAddress.empty,
        });
      });
      it("finds edges by src prefix", () => {
        expectConsistentEdges({
          addressPrefix: EdgeAddress.empty,
          srcPrefix: NodeAddress.fromParts(["src", "1"]),
          dstPrefix: NodeAddress.empty,
        });
      });
      it("finds edges by dst prefix", () => {
        expectConsistentEdges({
          addressPrefix: EdgeAddress.empty,
          srcPrefix: NodeAddress.empty,
          dstPrefix: NodeAddress.fromParts(["dst", "1"]),
        });
      });
      it("yields nothing for disjoint filters", () => {
        expectConsistentEdges({
          addressPrefix: EdgeAddress.fromParts(["e", "1"]),
          srcPrefix: NodeAddress.fromParts(["src", "2"]),
          dstPrefix: NodeAddress.empty,
        });
      });
      it("yields appropriate filter intersection", () => {
        expectConsistentEdges({
          addressPrefix: EdgeAddress.empty,
          srcPrefix: NodeAddress.fromParts(["src", "1"]),
          dstPrefix: NodeAddress.fromParts(["dst", "2"]),
        });
      });
    });

    describe("edge filter options", () => {
      it("requires `addressPrefix` to be present in provided options", () => {
        expect(() => {
          pagerankGraph()
            // $ExpectFlowError
            .edges({srcPrefix: src1, dstPrefix: dst1});
        }).toThrow("Invalid address prefix: undefined");
      });
      it("requires `srcPrefix` to be present in provided options", () => {
        expect(() => {
          pagerankGraph()
            // $ExpectFlowError
            .edges({addressPrefix: e11, dstPrefix: dst1});
        }).toThrow("Invalid src prefix: undefined");
      });

      it("requires `dstPrefix` to be present in provided options", () => {
        expect(() => {
          pagerankGraph()
            // $ExpectFlowError
            .edges({addressPrefix: e11, srcPrefix: dst1});
        }).toThrow("Invalid dst prefix: undefined");
      });
    });
  });

  describe("neighbors", () => {
    const allNeighbors = () => ({
      direction: Direction.ANY,
      nodePrefix: NodeAddress.empty,
      edgePrefix: EdgeAddress.empty,
    });
    it("is an error to call neighbors after modifying the underlying graph", () => {
      const pg = examplePagerankGraph();
      pg.graph().addNode(NodeAddress.fromParts(["foomfazzle"]));
      expect(() =>
        pg.neighbors(NodeAddress.fromParts(["src"]), allNeighbors())
      ).toThrowError("has been modified");
    });
    it("it is an error to call neighbors on a non-existent node", () => {
      const pg = examplePagerankGraph();
      expect(() =>
        pg.neighbors(NodeAddress.fromParts(["foomfazzle"]), allNeighbors())
      ).toThrowError("non-existent node");
    });
    it("neighbors returns results consistent with Graph.neighbors", () => {
      const directions = [Direction.IN, Direction.ANY, Direction.OUT];
      const nodePrefixes = [
        NodeAddress.empty,
        NodeAddress.fromParts(["src"]),
        NodeAddress.fromParts(["nonexistent"]),
      ];
      const edgePrefixes = [
        EdgeAddress.empty,
        EdgeAddress.fromParts(["hom"]),
        EdgeAddress.fromParts(["nonexistent"]),
      ];
      const targets = [
        NodeAddress.fromParts(["src"]),
        NodeAddress.fromParts(["loop"]),
      ];

      const graph = advancedGraph().graph1();
      const pagerankGraph = new PagerankGraph(graph, defaultEvaluator);
      for (const direction of directions) {
        for (const nodePrefix of nodePrefixes) {
          for (const edgePrefix of edgePrefixes) {
            for (const target of targets) {
              const options = {direction, nodePrefix, edgePrefix};
              const prgNeighbors = Array.from(
                pagerankGraph.neighbors(target, options)
              );
              const gNeighbors = Array.from(graph.neighbors(target, options));
              const reducedPrgNeighbors = prgNeighbors.map((s) => ({
                node: s.scoredNode.node,
                edge: s.weightedEdge.edge,
              }));
              expect(gNeighbors).toEqual(reducedPrgNeighbors);
            }
          }
        }
      }
    });
  });

  describe("score decomposition", () => {
    const allNeighbors = () => ({
      direction: Direction.ANY,
      nodePrefix: NodeAddress.empty,
      edgePrefix: EdgeAddress.empty,
    });
    it("neighbor's scored contributions are computed correctly", async () => {
      const pg = await convergedPagerankGraph();
      for (const {node: target} of pg.nodes()) {
        for (const {
          scoredNode,
          weightedEdge,
          scoreContribution,
        } of pg.neighbors(target, allNeighbors())) {
          let rawWeight = 0;
          if (weightedEdge.edge.dst === target) {
            rawWeight += weightedEdge.weight.toWeight;
          }
          if (weightedEdge.edge.src === target) {
            rawWeight += weightedEdge.weight.froWeight;
          }
          const normalizedWeight =
            rawWeight / pg.totalOutWeight(scoredNode.node);
          expect(scoreContribution).toEqual(
            scoredNode.score * normalizedWeight
          );
        }
      }
    });
    it("synthetic score contributions are computed correctly", async () => {
      const pg = await convergedPagerankGraph();
      for (const {node, score} of pg.nodes()) {
        expect(pg.syntheticLoopScoreContribution(node)).toEqual(
          (score * pg.syntheticLoopWeight()) / pg.totalOutWeight(node)
        );
      }
    });
    it("neighbors score contributions + synthetic score contribution == node score", async () => {
      // Note: I've verified that test fails if we don't properly handle loop
      // neighbors (need to add the edge toWeight and froWeight if the neighbor
      // is a loop).
      const pg = await convergedPagerankGraph();
      for (const {node, score} of pg.nodes()) {
        // We need to include the score that came from the synthetic loop edge
        // (should be near zero for non-isolated nodes)
        let summedScoreContributions: number = pg.syntheticLoopScoreContribution(
          node
        );
        for (const scoredNeighbor of pg.neighbors(node, allNeighbors())) {
          summedScoreContributions += scoredNeighbor.scoreContribution;
        }
        expect(summedScoreContributions).toBeCloseTo(score);
      }
    });
  });

  describe("runPagerank", () => {
    // The mathematical semantics of PageRank are thoroughly tested
    // in the markovChain module. The goal for these tests is just
    // to make sure that the API calls are glued together properly,
    // so it's mostly option + sanity checking

    function checkUniformDistribution(pg: PagerankGraph) {
      const nodes = Array.from(pg.nodes());
      for (const {score} of nodes) {
        expect(score).toEqual(1 / nodes.length);
      }
    }

    function checkProbabilityDistribution(pg: PagerankGraph) {
      let total = 0;
      for (const {score} of pg.nodes()) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
        total += score;
      }
      expect(total).toBeCloseTo(1);
    }

    // Verify that PagerankParams are generated properly based on the seed information.
    describe("seed paramter generation", () => {
      async function paramsForSeed(
        seed: PagerankSeedOptions
      ): Promise<{params: PagerankParams, osmc: OrderedSparseMarkovChain}> {
        const eg = examplePagerankGraph();
        let params: PagerankParams | null = null;
        let osmc: OrderedSparseMarkovChain | null = null;
        // Find a less hacky way to test this codepath (without complicating the API)
        (eg: any)._runPagerankFromParams = async function(params_, osmc_) {
          params = params_;
          osmc = osmc_;
          return {convergenceDelta: 0};
        };
        await eg.runPagerank(seed, {maxIterations: 1, convergenceThreshold: 1});
        return {params: NullUtil.get(params), osmc: NullUtil.get(osmc)};
      }
      const getAllNodes = () =>
        Array.from(
          examplePagerankGraph()
            .graph()
            .nodes()
        );
      const numNodes = getAllNodes().length;

      it("doesn't support SPECIFIED_SEED", async () => {
        const promise = paramsForSeed({
          type: "SPECIFIED_SEED",
          alpha: 0.5,
          scoreMap: new Map(),
        });
        return expect(promise).rejects.toThrow("Not yet implemented");
      });

      describe("sets alpha to", () => {
        it("0 for NO_SEED", async () => {
          const {params} = await paramsForSeed({
            type: "NO_SEED",
          });
          expect(params.alpha).toBe(0);
        });
        it("alpha for UNIFORM_SEED", async () => {
          const {params} = await paramsForSeed({
            type: "UNIFORM_SEED",
            alpha: 0.5,
          });
          expect(params.alpha).toBe(0.5);
        });
        it("alpha for SELECTED_SEED", async () => {
          const {params} = await paramsForSeed({
            type: "SELECTED_SEED",
            selectedNodes: [],
            alpha: 0.5,
          });
          expect(params.alpha).toBe(0.5);
        });
      });

      describe("sets seed to", () => {
        it("uniform for NO_SEED", async () => {
          const {params} = await paramsForSeed({type: "NO_SEED"});
          expect(params.seed).toEqual(uniformDistribution(numNodes));
        });
        it("uniform for UNIFORM_SEED", async () => {
          const {params} = await paramsForSeed({
            type: "UNIFORM_SEED",
            alpha: 0.5,
          });
          expect(params.seed).toEqual(uniformDistribution(numNodes));
        });
        it("uniform for SELECTED_SEED with 0 selectedNodes", async () => {
          const {params} = await paramsForSeed({
            type: "SELECTED_SEED",
            selectedNodes: [],
            alpha: 0.5,
          });
          expect(params.seed).toEqual(uniformDistribution(numNodes));
        });
        it("uniform for SELECTED_SEED with all nodes selected", async () => {
          const {params} = await paramsForSeed({
            type: "SELECTED_SEED",
            selectedNodes: getAllNodes(),
            alpha: 0.5,
          });
          expect(params.seed).toEqual(uniformDistribution(numNodes));
        });
        it("indicator distribution when 1 selected node", async () => {
          // Kind of a clever/hacky way to test what the seed was, leveraging that
          // it will converge to the seed when alpha=1
          const node = getAllNodes()[0];
          const seed = {
            type: "SELECTED_SEED",
            alpha: 1,
            selectedNodes: [node],
          };
          const eg = await convergedPagerankGraph(seed);
          const score = NullUtil.get(eg.node(node)).score;
          expect(score).toBe(1);
        });
        it("uniform over selected nodes when more selected nodes", async () => {
          // Kind of a clever/hacky way to test what the seed was, leveraging that
          // it will converge to the seed when alpha=1
          const n0 = getAllNodes()[0];
          const n1 = getAllNodes()[1];
          const seed = {
            type: "SELECTED_SEED",
            alpha: 1,
            selectedNodes: [n0, n1],
          };
          const eg = await convergedPagerankGraph(seed);
          expect(NullUtil.get(eg.node(n0)).score).toBe(0.5);
          expect(NullUtil.get(eg.node(n1)).score).toBe(0.5);
        });
      });

      it("uniform seed and no alpha when NO_SEED", async () => {
        const {params} = await paramsForSeed({type: "NO_SEED"});
        expect(params.alpha).toBe(0);
        expect(params.seed).toEqual(uniformDistribution(numNodes));
      });
    });

    it("promise rejects if the graph was modified", async () => {
      const pg = examplePagerankGraph();
      pg.graph().addNode(NodeAddress.empty);
      expect(
        pg.runPagerank(
          {type: "NO_SEED"},
          {maxIterations: 1, convergenceThreshold: 1}
        )
      ).rejects.toThrow("underlying Graph has been modified");
      // It's possible that you could avoid the rejection if you
      // make the modification after calling runPagerank (but before
      // promise resolves). However, since every getter also checks
      // for modification, this is not a serious issue.
    });
    it("scores are a uniform distribution prior to running PageRank", () => {
      checkUniformDistribution(examplePagerankGraph());
    });
    it("respects maxIterations==0", async () => {
      const pg = examplePagerankGraph();
      const results = await pg.runPagerank(
        {type: "NO_SEED"},
        {
          maxIterations: 0,
          convergenceThreshold: 0,
        }
      );
      expect(results.convergenceDelta).toBeGreaterThan(0);
      checkUniformDistribution(pg);
    });
    it("will limit at max iterations when convergence threshld is low", async () => {
      const pg = examplePagerankGraph();
      const convergenceThreshold = 1e-18;
      const results = await pg.runPagerank(
        {type: "NO_SEED"},
        {
          maxIterations: 17,
          convergenceThreshold,
        }
      );
      expect(results.convergenceDelta).toBeGreaterThan(convergenceThreshold);
      checkProbabilityDistribution(pg);
    });
    it("will converge when threshold is high", async () => {
      const pg = examplePagerankGraph();
      const convergenceThreshold = 0.01;
      const results = await pg.runPagerank(
        {type: "NO_SEED"},
        {
          maxIterations: 170,
          convergenceThreshold,
        }
      );
      expect(results.convergenceDelta).toBeLessThan(convergenceThreshold);
      checkProbabilityDistribution(pg);
    });
  });

  describe("equals", () => {
    it("PagerankGraph is equal to itself", () => {
      const pg = examplePagerankGraph();
      expect(pg.equals(pg)).toBe(true);
    });
    it("two identicalPagerankGraphs are equal", () => {
      const pg1 = examplePagerankGraph();
      const pg2 = examplePagerankGraph();
      expect(pg1.equals(pg2)).toBe(true);
    });
    it("unequal syntheticLoopWeight => unequal", () => {
      const pg1 = new PagerankGraph(nonEmptyGraph(), defaultEvaluator, 0.1);
      const pg2 = new PagerankGraph(nonEmptyGraph(), defaultEvaluator, 0.2);
      expect(pg1.equals(pg2)).toBe(false);
    });
    it("unequal graph => unequal", () => {
      const pg1 = new PagerankGraph(nonEmptyGraph(), defaultEvaluator, 0.1);
      const g2 = nonEmptyGraph().addNode(NodeAddress.empty);
      const pg2 = new PagerankGraph(g2, defaultEvaluator, 0.1);
      expect(pg1.equals(pg2)).toBe(false);
    });
    it("unequal scores => unequal", async () => {
      const pg1 = examplePagerankGraph();
      const pg2 = examplePagerankGraph();
      await pg1.runPagerank(
        {type: "NO_SEED"},
        {maxIterations: 2, convergenceThreshold: 0.001}
      );
      expect(pg1.equals(pg2)).toBe(false);
    });
    it("unequal edge weights => unequal", () => {
      const evaluator1 = (_unused_edge) => ({toWeight: 1, froWeight: 1});
      const evaluator2 = (_unused_edge) => ({toWeight: 0, froWeight: 1});
      const pg1 = new PagerankGraph(advancedGraph().graph1(), evaluator1);
      const pg2 = new PagerankGraph(advancedGraph().graph1(), evaluator2);
      expect(pg1.equals(pg2)).toBe(false);
    });
    it("different modification history => still equal", () => {
      // advancedGraph.graph1 and graph2 are identical except for their
      // construction history
      const pg1 = new PagerankGraph(advancedGraph().graph1(), defaultEvaluator);
      const pg2 = new PagerankGraph(advancedGraph().graph2(), defaultEvaluator);
      expect(pg1.equals(pg2)).toBe(true);
    });
    it("throws an error if comparing PagerankGraph to non-PagerankGraph", () => {
      const pg = examplePagerankGraph();
      const g = new Graph();
      // $ExpectFlowError
      expect(() => pg.equals(g)).toThrowError("Expected PagerankGraph");
    });
    it("throws an error if the underlying graph is modified", () => {
      const pg = examplePagerankGraph();
      pg.graph().addNode(NodeAddress.fromParts(["modification"]));
      expect(() => pg.equals(pg)).toThrowError("has been modified");
    });
  });

  describe("to/from JSON", () => {
    it("to->fro is identity", async () => {
      const pg = await convergedPagerankGraph();
      const pgJSON = pg.toJSON();
      const pg_ = PagerankGraph.fromJSON(pgJSON);
      expect(pg.equals(pg_)).toBe(true);
    });
    it("fro->to is identity", async () => {
      const pg = await convergedPagerankGraph();
      const pgJSON = pg.toJSON();
      const pg_ = PagerankGraph.fromJSON(pgJSON);
      const pgJSON_ = pg_.toJSON();
      expect(pgJSON).toEqual(pgJSON_);
    });
    it("is canonical with respect to the graph's history", async () => {
      const pg1 = new PagerankGraph(advancedGraph().graph1(), defaultEvaluator);
      const pg2 = new PagerankGraph(advancedGraph().graph2(), defaultEvaluator);
      const pg1JSON = pg1.toJSON();
      const pg2JSON = pg2.toJSON();
      expect(pg1JSON).toEqual(pg2JSON);
    });
    it("matches expected snapshot", () => {
      const pgJSON = examplePagerankGraph().toJSON();
      expect(pgJSON).toMatchSnapshot();
    });
  });
});
