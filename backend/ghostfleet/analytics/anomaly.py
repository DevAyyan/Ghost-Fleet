"""Isolation Forest (Liu, Ting & Zhou 2008) with per-feature explanations, in numpy only.

Why this model: there are no reliable labels for "a ship doing something wrong", so a supervised classifier would only
learn our own guesses. An isolation forest needs no labels: it scores how easily a ship's behaviour profile can be
separated from everyone else's by random splits. Unusual combinations are isolated in few splits.

Explanations (in the spirit of DIFFI, Carletti et al. 2020): every split on a ship's path through a tree credits the
feature it used, weighted by how much of the node that split cut away from the ship (sending it into a small branch
isolates it; a 50/50 split hardly does). Credits are summed over the forest and normalised to shares per ship, so
"62% from AIS switch-offs" means most of the isolating splits used that feature.
"""
from __future__ import annotations

import math

import numpy as np

EULER = 0.5772156649


def _c(n: float) -> float:
    """Average path length of an unsuccessful binary-search-tree search over n points (the IF normaliser)."""
    if n <= 1:
        return 0.0
    if n == 2:
        return 1.0
    return 2.0 * (math.log(n - 1) + EULER) - 2.0 * (n - 1) / n


class _Tree:
    """One isolation tree stored as flat arrays so all points can walk it at once."""

    def __init__(self, X: np.ndarray, rng: np.random.Generator, max_depth: int):
        self.feat, self.thr, self.left, self.right, self.size = [], [], [], [], []
        self._grow(X, rng, 0, max_depth)
        self.feat, self.thr = np.array(self.feat), np.array(self.thr)
        self.left, self.right, self.size = np.array(self.left), np.array(self.right), np.array(self.size, dtype=float)

    def _grow(self, X: np.ndarray, rng: np.random.Generator, depth: int, max_depth: int) -> int:
        node = len(self.feat)
        self.feat.append(-1); self.thr.append(0.0); self.left.append(-1); self.right.append(-1); self.size.append(len(X))
        if depth >= max_depth or len(X) <= 1:
            return node
        lo, hi = X.min(axis=0), X.max(axis=0)
        usable = np.flatnonzero(hi > lo)
        if usable.size == 0:
            return node
        f = int(rng.choice(usable))
        t = float(rng.uniform(lo[f], hi[f]))
        mask = X[:, f] < t
        self.feat[node], self.thr[node] = f, t
        self.left[node] = self._grow(X[mask], rng, depth + 1, max_depth)
        self.right[node] = self._grow(X[~mask], rng, depth + 1, max_depth)
        return node

    def walk(self, X: np.ndarray, credit: np.ndarray) -> np.ndarray:
        """Path length of every row (with the c(n) leaf correction); adds each row's isolating credit per feature."""
        n = len(X)
        node, depth = np.zeros(n, dtype=int), np.zeros(n)
        active = self.feat[node] >= 0
        rows = np.arange(n)
        while active.any():
            r, nd = rows[active], node[active]
            f = self.feat[nd]
            go_left = X[r, f] < self.thr[nd]
            child = np.where(go_left, self.left[nd], self.right[nd])
            # how much of the node this split cut away from the row: 1 - child/parent
            np.add.at(credit, (r, f), 1.0 - self.size[child] / self.size[nd])
            node[r], depth[r] = child, depth[r] + 1
            active = self.feat[node] >= 0
        return depth + np.array([_c(s) for s in self.size[node]])


def isolation_forest(X: np.ndarray, n_trees: int = 200, sample: int = 256, seed: int = 7) -> tuple[np.ndarray, np.ndarray]:
    """Anomaly score in (0, 1) per row (above ~0.6 is unusual) and each row's explanation shares per feature (rows sum to 1)."""
    X = np.asarray(X, dtype=float)
    n, d = X.shape
    if n < 2:
        return np.zeros(n), np.zeros((n, d))
    rng = np.random.default_rng(seed)
    psi = min(sample, n)
    max_depth = math.ceil(math.log2(psi))
    path, credit = np.zeros(n), np.zeros((n, d))
    for _ in range(n_trees):
        idx = rng.choice(n, size=psi, replace=False)
        path += _Tree(X[idx], rng, max_depth).walk(X, credit)
    score = 2.0 ** (-(path / n_trees) / _c(psi))
    total = credit.sum(axis=1, keepdims=True)
    share = np.divide(credit, total, out=np.zeros_like(credit), where=total > 0)
    return score, share
