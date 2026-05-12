"""
DAG helper — cycle detection between macro_tasks.
Uses DFS with coloring (white/grey/black) on a directed graph.
"""
from __future__ import annotations
from typing import Iterable


def has_cycle(start_id: int, dependencies: list[int], get_deps: callable) -> bool:
    """
    Returns True if introducing `dependencies` for `start_id`
    creates a cycle in the overall graph.

    get_deps(id) -> list[int]  — callable that returns the already
                                 saved dependencies for a given macro ID.
    """
    WHITE, GREY, BLACK = 0, 1, 2
    color: dict[int, int] = {}

    def dfs(node: int) -> bool:
        color[node] = GREY
        for neighbour in (get_deps(node) if node != start_id else dependencies):
            if color.get(neighbour, WHITE) == GREY:
                return True
            if color.get(neighbour, WHITE) == WHITE:
                if dfs(neighbour):
                    return True
        color[node] = BLACK
        return False

    return dfs(start_id)