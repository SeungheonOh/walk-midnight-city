declare module '*NeonCityPage-BPSPbVZP.js' {
  export function createNativeScene(container: HTMLElement, select: (id: string) => void, status: (status: { loading: boolean; error: string | null; detail?: string }) => void, unfollow: () => void, modelStatus: () => void, visitor: unknown): {
    setWorld(world: unknown, spaceId: string): Promise<void>;
    select(id: string | null, follow: boolean): void;
    dispose(): void;
  };
}
