export type IslandState = "idle" | "alert" | "peek" | "expanded";

export type IslandAction =
  | { type: "set"; state: IslandState }
  | { type: "dismiss" }
  | { type: "hover"; active: boolean };

export function islandReducer(
  state: IslandState,
  action: IslandAction,
): IslandState {
  switch (action.type) {
    case "set":
      return action.state;
    case "dismiss":
      return state === "peek" ? "idle" : state;
    case "hover":
      if (action.active) return "expanded";
      return state === "expanded" ? "idle" : state;
  }
}
