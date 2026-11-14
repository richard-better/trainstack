import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api";
import { type CheckIn, checkInsQueryKey, placeCheckIn } from "../lib/check-in";

type Range = Awaited<ReturnType<typeof api.checkIns.range>>;

export function useCheckIns(from: string, through: string, { enabled = true } = {}) {
  return useQuery({
    queryKey: checkInsQueryKey(from, through),
    queryFn: () => api.checkIns.range({ from, through }),
    enabled,
  });
}

export function useCheckInOn(day: string, { enabled = true } = {}) {
  const range = useCheckIns(day, day, { enabled });
  return { ...range, checkIn: range.data ? (range.data.checkIns[0] ?? null) : undefined };
}

function useHeld() {
  const queryClient = useQueryClient();
  return async (day: string, held: CheckIn | null) => {
    const covering = {
      queryKey: ["check-ins"],
      predicate: ({ queryKey }: { queryKey: readonly unknown[] }) => {
        const [, from, through] = queryKey as ReturnType<typeof checkInsQueryKey>;
        return from <= day && day <= through;
      },
    };
    await queryClient.cancelQueries(covering);
    for (const [key, data] of queryClient.getQueriesData<Range>(covering)) {
      if (data) {
        queryClient.setQueryData<Range>(key, {
          ...data,
          checkIns: placeCheckIn(data.checkIns, day, held),
        });
      } else {
        void queryClient.invalidateQueries({ queryKey: key, exact: true });
      }
    }
  };
}

export function useSaveCheckIn() {
  const hold = useHeld();
  return useMutation({
    mutationFn: (checkIn: CheckIn) => api.checkIns.put(checkIn),
    onSuccess: ({ day, checkIn }) => hold(day, checkIn),
  });
}

export function useRemoveCheckIn() {
  const hold = useHeld();
  return useMutation({
    mutationFn: (day: string) => api.checkIns.remove({ day, updatedAt: new Date() }),
    onSuccess: ({ day, checkIn }) => hold(day, checkIn),
  });
}
