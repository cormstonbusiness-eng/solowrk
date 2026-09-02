import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { CircleCheckBig, Columns3, List, Plus } from "lucide-react";
import type { TaskStatus, TaskWithContext } from "@shared/types";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/Field";
import { Empty } from "@/components/ui/Empty";
import { Swap } from "@/components/ui/Swap";
import { keys, useInvalidate } from "@/lib/api";
import { TICK_SETTLE_MS, transition } from "@/lib/motion";
import { QuickAddHint, useQuickAdd } from "@/components/list/QuickAdd";
import { useEntityActions } from "@/hooks/useEntityActions";
import { TaskRow } from "./TaskRow";
import { TaskModal } from "./TaskModal";
import { TaskBoard } from "./TaskBoard";
import { ViewSwitcher } from "@/components/list/Toolbar";
import { cn } from "@/lib/utils";
import { BulkBar } from "@/components/list/BulkBar";
import { useSelection } from "@/hooks/useSelection";
import { useUndo } from "@/hooks/useUndo";

type View = "board" | "list";

/**
 * Where the board-or-list choice is kept.
 *
 * One key for every project rather than one each, because it is a preference
 * about how somebody likes to read work, not a fact about a particular job.
 * Being told "you last looked at this project as a list" is not useful; being
 * shown the shape you always use is.
 *
 * Wrapped, because storage throws rather than returns null in a few real
 * situations, and a preference is never worth a blank screen.
 */
const VIEW_KEY = "solo.project.tasks.view";

function storedView(): View {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "board";
  } catch {
    return "board";
  }
}

function rememberView(view: View): void {
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Not worth a word to the user. The choice simply will not survive a
    // restart, which is a smaller problem than the one it would announce.
  }
}

/**
 * The tasks for a single project, as a board or a list.
 *
 * The board is the same component the Tasks page uses, over this project's
 * tasks — the columns are the statuses, so dragging a card is how a task
 * becomes in progress or done. The list stays because it is better at length,
 * at multi-select and at keyboard work, and because a board of forty cards is
 * not an improvement on anything.
 */
export function TaskList({
  projectId,
}: {
  projectId: number;
}): React.JSX.Element {
  const invalidate = useInvalidate();
  const [title, setTitle] = useState("");
  const [open, setOpen] = useState<TaskWithContext | null>(null);
  const [view, setViewState] = useState<View>(storedView);

  const setView = (next: View): void => {
    setViewState(next);
    rememberView(next);
  };

  const filter = { projectId, topLevelOnly: true };
  const { data: tasks = [] } = useQuery({
    queryKey: keys.tasks(filter),
    queryFn: () => window.solo.invoke("tasks:list", filter),
  });

  const quick = useQuickAdd(title);

  const create = useMutation({
    mutationFn: () =>
      window.solo.invoke("tasks:create", {
        title: quick.parsed.title || title.trim(),
        // The project this list belongs to wins over a typed #tag: you are
        // looking at one project's tasks, and a task added here belongs to it.
        projectId,
        categoryId: quick.categoryId ?? undefined,
        dueAt: quick.dueAt,
        priority: quick.parsed.priority ?? undefined,
      }),
    onSuccess: () => {
      invalidate(["tasks"]);
      setTitle("");
    },
  });

  const archive = useMutation({
    mutationFn: (id: number) =>
      window.solo.invoke("tasks:update", { id, patch: { archived: true } }),
    onSuccess: () => invalidate(["tasks"]),
  });

  const actions = useEntityActions();
  const { offer } = useUndo();

  const remove = useMutation({
    mutationFn: (task: { id: number; title: string }) =>
      actions.remove({ type: "task", id: task.id }, task.title),
  });

  const toggle = useMutation({
    mutationFn: (task: TaskWithContext) =>
      window.solo.invoke("tasks:update", {
        id: task.id,
        patch: { status: task.status === "done" ? "todo" : "done" },
      }),
    // Delayed on purpose — see TICK_SETTLE_MS. The row has an animation to
    // finish before it is allowed to move to the Done list.
    onSuccess: () => setTimeout(() => invalidate(["tasks"]), TICK_SETTLE_MS),
  });

  const open_ = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");

  // Open first, then done — the order they are drawn in, so the drawer's
  // arrows walk the list the way the eye does, and so a Shift-range covers
  // what is between two rows on screen rather than between two ids.
  const shown = [...open_, ...done];
  const siblings = shown.map((task) => ({
    type: "task" as const,
    id: task.id,
  }));
  const selection = useSelection(shown.map((task) => task.id));

  const rename = useMutation({
    mutationFn: (input: { id: number; title: string }) =>
      window.solo.invoke("tasks:update", {
        id: input.id,
        patch: { title: input.title },
      }),
    onSuccess: () => invalidate(["tasks"]),
  });

  /**
   * Dropping a card into a column.
   *
   * `projectId` is carried through unchanged: the board inside a project moves
   * a task between statuses, never out of the project it is being viewed in.
   */
  const move = useMutation({
    mutationFn: (args: {
      id: number;
      status: TaskStatus;
      projectId: number | null;
    }) => window.solo.invoke("tasks:move", { ...args, beforeId: null }),
    onSuccess: () => invalidate(["tasks"]),
  });

  /**
   * Bulk actions, each as one decision with one undo.
   *
   * Archiving nine tasks is a single thing somebody did, and offering nine
   * separate undos for it would be offering to half-undo it — which is worse
   * than not offering at all.
   */
  const chosen = shown.filter((task) => selection.isSelected(task.id));

  const bulkArchive = async (): Promise<void> => {
    const ids = chosen.map((task) => task.id);
    selection.clear();
    for (const id of ids) {
      await window.solo.invoke("tasks:update", {
        id,
        patch: { archived: true },
      });
    }
    invalidate(["tasks"]);
    offer(
      `Archived ${ids.length} task${ids.length === 1 ? "" : "s"}`,
      async () => {
        for (const id of ids) {
          await window.solo.invoke("tasks:update", {
            id,
            patch: { archived: false },
          });
        }
        invalidate(["tasks"]);
      },
    );
  };

  const bulkDelete = async (): Promise<void> => {
    // Through the trash, one at a time, exactly as a single delete goes —
    // which is what makes all of them restorable afterwards.
    const targets = [...chosen];
    selection.clear();
    for (const task of targets) {
      await window.solo.invoke("entity:delete", { type: "task", id: task.id });
    }
    invalidate(["tasks"]);
    offer(`Deleted ${targets.length} task${targets.length === 1 ? "" : "s"}`);
  };

  return (
    // Three columns need the room; a single list reads badly wide.
    <div className={cn(view === "board" ? "max-w-[1180px]" : "max-w-[860px]")}>
      <div className="mb-3 flex gap-2">
        <div className="min-w-0 flex-1">
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && title.trim()) create.mutate();
            }}
            placeholder="Draw the logo friday ~Design"
          />
          <QuickAddHint resolved={quick} />
        </div>
        <Button
          variant="primary"
          onClick={() => title.trim() && create.mutate()}
          disabled={!title.trim()}
        >
          <Plus size={14} strokeWidth={1.75} />
          Add
        </Button>
        <ViewSwitcher
          value={view}
          onChange={setView}
          options={[
            { value: "board", label: "Board", icon: Columns3 },
            { value: "list", label: "List", icon: List },
          ]}
        />
      </div>

      <Swap
        empty={tasks.length === 0}
        fallback={
          <Empty
            icon={CircleCheckBig}
            title="No tasks yet"
            body="Add the first thing that needs doing. Give tasks a category to colour-code them, and a due date to see them on the dashboard."
          />
        }
      >
        {view === "board" ? (
          <TaskBoard
            tasks={shown}
            onMove={(task, status) =>
              move.mutate({ id: task.id, status, projectId: task.projectId })
            }
            onToggle={(task) => toggle.mutate(task)}
            onOpen={setOpen}
            showProject={false}
          />
        ) : (
          <div className="flex flex-col gap-1">
            <AnimatePresence initial={false}>
              {open_.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  siblings={siblings}
                  selected={selection.isSelected(task.id)}
                  selectable={selection.count > 0}
                  onSelect={(modifiers) => selection.click(task.id, modifiers)}
                  onRename={(title) => rename.mutate({ id: task.id, title })}
                  onToggle={() => toggle.mutate(task)}
                  onOpen={() => setOpen(task)}
                  onArchive={() => archive.mutate(task.id)}
                  onDelete={() => remove.mutate(task)}
                />
              ))}
            </AnimatePresence>

            {done.length > 0 && (
              <>
                <motion.p
                  layout
                  transition={transition.layout}
                  className="mt-3 mb-1 text-[11px] tracking-[0.08em] text-faint uppercase"
                >
                  Done ({done.length})
                </motion.p>
                <AnimatePresence initial={false}>
                  {done.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      siblings={siblings}
                      selected={selection.isSelected(task.id)}
                      selectable={selection.count > 0}
                      onSelect={(modifiers) =>
                        selection.click(task.id, modifiers)
                      }
                      onToggle={() => toggle.mutate(task)}
                      onOpen={() => setOpen(task)}
                    />
                  ))}
                </AnimatePresence>
              </>
            )}
          </div>
        )}
      </Swap>

      {/*
        List only. The board is a different gesture — you pick a card up rather
        than tick it — and a selection checkbox on a draggable card fights the
        drag for the same first few pixels of every press.
      */}
      {view === "list" && (
        <BulkBar
          count={selection.count}
          noun="task"
          onArchive={() => void bulkArchive()}
          onDelete={() => void bulkDelete()}
          onClear={selection.clear}
        />
      )}

      <TaskModal task={open} onClose={() => setOpen(null)} />
    </div>
  );
}
