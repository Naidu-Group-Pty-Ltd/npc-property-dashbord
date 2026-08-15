import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActivateClientDialog } from "../ActivateClientDialog";

class TestResizeObserver { observe() {} unobserve() {} disconnect() {} }
Object.defineProperty(globalThis, "ResizeObserver", { writable: true, value: TestResizeObserver });

const getClientForActivation = vi.fn();
const listClientsForActivation = vi.fn();
const activateClient = vi.fn();

vi.mock("@/lib/aml/amlCasesApi", () => ({
  amlCasesApi: {
    getClientForActivation: (...a: unknown[]) => getClientForActivation(...a),
    listClientsForActivation: (...a: unknown[]) => listClientsForActivation(...a),
    activateClient: (...a: unknown[]) => activateClient(...a),
  },
}));

/** A picker page as the server returns it. */
const page = (
  clients: unknown[],
  extra: { total?: number; has_more?: boolean; browsing?: boolean } = {},
) => ({
  clients,
  total: extra.total ?? clients.length,
  has_more: extra.has_more ?? false,
  browsing: extra.browsing ?? true,
});
vi.mock("@/lib/aml/amlTenantApi", () => ({
  amlTenantApi: { getActivationProgram: vi.fn().mockResolvedValue(null) },
}));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toast(...a) }));

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";

const inactiveClient = {
  id: CLIENT_ID,
  label: "Rugesh Naidu",
  email: "rugesh@example.test",
  mobile: "0400 111 222",
  is_active: false,
  has_open_case: false,
  open_case: null,
};

function setup(props: Partial<Parameters<typeof ActivateClientDialog>[0]> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onActivated = vi.fn();
  const onOpenChange = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <ActivateClientDialog
        open
        onOpenChange={onOpenChange}
        onActivated={onActivated}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...view, onActivated, onOpenChange };
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("Activation event"), {
    target: { value: "Signed engagement letter" },
  });
  fireEvent.change(screen.getByLabelText(/Reason & evidence/), {
    target: { value: "Executed agency agreement received on file." },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "Confirm activation event" }));
}

beforeEach(() => {
  getClientForActivation.mockReset();
  listClientsForActivation.mockReset();
  // The picker browses on open, so every test needs a default page.
  listClientsForActivation.mockResolvedValue(page([]));
  activateClient.mockReset();
  toast.mockReset();
});

describe("ActivateClientDialog — route/record preselection", () => {
  it("loads the exact client server-side and prefills the subject name from the authoritative record", async () => {
    getClientForActivation.mockResolvedValue({ client: inactiveClient });
    setup({ clientId: CLIENT_ID, clientName: "Tampered Browser Name" });

    await waitFor(() => expect(getClientForActivation).toHaveBeenCalledWith(CLIENT_ID));
    await waitFor(() =>
      expect(screen.getByTestId("ac-selected-client")).toHaveTextContent("Rugesh Naidu"));

    // Prefilled from the server record, not the caller-supplied label.
    expect(screen.getByLabelText("Subject display name")).toHaveValue("Rugesh Naidu");
    expect(screen.getByTestId("ac-selected-client")).toHaveTextContent("rugesh@example.test");
    expect(screen.getByTestId("ac-selected-client")).toHaveTextContent("0400 111 222");
  });

  it("shows the inactive status and the activation-on-confirm messages for an inactive client", async () => {
    getClientForActivation.mockResolvedValue({ client: inactiveClient });
    setup({ clientId: CLIENT_ID });

    await waitFor(() =>
      expect(screen.getByText(/Inactive client — this client will be marked active/)).toBeInTheDocument());
    expect(screen.getByText(/This client is currently inactive\. Confirming this form will activate the client and start AML\/CTF compliance\./)).toBeInTheDocument();
    // The old dead-end wording must be gone.
    expect(screen.queryByText(/Mark the client active on their record first/)).not.toBeInTheDocument();
  });

  it("keeps Activate disabled until all required fields and the confirmation are complete, then submits with the trusted client id", async () => {
    getClientForActivation.mockResolvedValue({ client: inactiveClient });
    activateClient.mockResolvedValue({
      case: { id: "case-1", case_reference: "AML-2026-00001" },
      client_activation: { was_inactive: true, marked_active: true },
      client_portal: { has_portal_access: true, notified: true, note: "Notified." },
    });
    const { onActivated } = setup({ clientId: CLIENT_ID });

    await waitFor(() => expect(screen.getByTestId("ac-selected-client")).toBeInTheDocument());
    const activate = screen.getByRole("button", { name: "Activate client" });
    expect(activate).toBeDisabled();

    fillRequiredFields();
    await waitFor(() => expect(activate).toBeEnabled());
    fireEvent.click(activate);

    await waitFor(() => expect(activateClient).toHaveBeenCalledTimes(1));
    expect(activateClient.mock.calls[0][0]).toMatchObject({
      client_id: CLIENT_ID,
      subject_display_name: "Rugesh Naidu",
      human_confirmed: true,
    });
    await waitFor(() => expect(onActivated).toHaveBeenCalled());
  });

  it("blocks activation and explains when an open AML case already exists", async () => {
    getClientForActivation.mockResolvedValue({
      client: {
        ...inactiveClient,
        is_active: true,
        has_open_case: true,
        open_case: { id: "case-9", case_reference: "AML-2026-00009" },
      },
    });
    setup({ clientId: CLIENT_ID });

    await waitFor(() =>
      expect(screen.getByText(/An open AML\/CTF case already exists for this client\./)).toBeInTheDocument());
    fillRequiredFields();
    expect(screen.getByRole("button", { name: "Activate client" })).toBeDisabled();
  });

  it("shows a clear error and no activation form when the client cannot be loaded", async () => {
    getClientForActivation.mockRejectedValue(new Error("Client not found"));
    setup({ clientId: CLIENT_ID });

    await waitFor(() =>
      expect(screen.getByText("This client could not be loaded")).toBeInTheDocument());
    expect(screen.getByText(/Client not found/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activate client" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Subject display name")).not.toBeInTheDocument();
  });
});

/**
 * The client picker.
 *
 * ── What was wrong ────────────────────────────────────────────────────
 * The picker returned nothing until an operator typed two characters, so
 * opening this dialog showed an empty box and every client the platform
 * already held was invisible until somebody guessed a name and spelled it.
 * On the deployment this was reported against that hid 775 clients — 40
 * active, 735 inactive — and it is why activation felt as though it wanted
 * clients re-entered that the business already had.
 *
 * These pin the browse-first behaviour and, just as importantly, the three
 * different "nothing here" answers: an empty register, an empty filter and
 * an unmatched search are not the same statement, and only one of them
 * means a client needs creating.
 */
describe("ActivateClientDialog — the client picker", () => {
  const alex = {
    id: "a", label: "Alex Naidu", email: "alex@example.test",
    mobile: null, is_active: true, has_open_case: false,
  };

  it("browses the register on open, before anything is typed", async () => {
    listClientsForActivation.mockResolvedValue(page([alex, { ...inactiveClient }], { total: 2 }));
    setup();

    // No typing: the clients are simply there.
    await waitFor(() => expect(screen.getByText("Alex Naidu")).toBeInTheDocument());
    expect(screen.getByText("Rugesh Naidu")).toBeInTheDocument();
    expect(listClientsForActivation).toHaveBeenCalledWith(
      expect.objectContaining({ query: "", status: "all", offset: 0 }),
    );
  });

  it("shows active and inactive together, and an inactive client is selectable", async () => {
    listClientsForActivation.mockResolvedValue(page([alex, { ...inactiveClient }], { total: 2 }));
    setup();
    await waitFor(() => expect(screen.getByText("Rugesh Naidu")).toBeInTheDocument());

    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Inactive").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Select Rugesh Naidu/ }));
    await waitFor(() =>
      expect(screen.getByTestId("ac-selected-client")).toHaveTextContent("Rugesh Naidu"));
    expect(screen.getByText(/Inactive client — this client will be marked active/)).toBeInTheDocument();
    expect(screen.getByLabelText("Subject display name")).toHaveValue("Rugesh Naidu");
  });

  it("narrows to a status slice without re-querying the whole register client-side", async () => {
    listClientsForActivation.mockResolvedValue(page([alex], { total: 1 }));
    setup();
    await waitFor(() => expect(screen.getByText("Alex Naidu")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Inactive" }));
    // The slice is a server filter, so the count it reports stays true.
    await waitFor(() => expect(listClientsForActivation).toHaveBeenCalledWith(
      expect.objectContaining({ status: "inactive", offset: 0 })));
  });

  it("searches through the same op rather than filtering what it already has", async () => {
    listClientsForActivation.mockResolvedValue(page([alex], { total: 1 }));
    setup();
    await waitFor(() => expect(screen.getByText("Alex Naidu")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Search clients"), { target: { value: "naidu" } });
    await waitFor(() => expect(listClientsForActivation).toHaveBeenCalledWith(
      expect.objectContaining({ query: "naidu" })), { timeout: 2000 });
  });

  it("lists a client that already has an open case, names it, and refuses selection", async () => {
    // Hiding it gives the worst answer a picker can give — "that client does
    // not exist" — when the truth is they are already covered.
    listClientsForActivation.mockResolvedValue(page([{
      ...inactiveClient, has_open_case: true,
      open_case: { case_reference: "AML-2026-00004" },
    }], { total: 1 }));
    setup();

    await waitFor(() => expect(screen.getByText("Rugesh Naidu")).toBeInTheDocument());
    expect(screen.getByText("AML-2026-00004")).toBeInTheDocument();
    const row = screen.getByRole("button", { name: /already has an open case/ });
    expect(row).toBeDisabled();

    fireEvent.click(row);
    expect(screen.queryByTestId("ac-selected-client")).not.toBeInTheDocument();
  });

  it("reports how many clients exist, not how many it drew", async () => {
    listClientsForActivation.mockResolvedValue(
      page([alex], { total: 775, has_more: true }));
    setup();
    await waitFor(() =>
      expect(screen.getByText("Showing 1 of 775 clients")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Load more/ })).toBeInTheDocument();
  });

  it("appends the next page instead of replacing the current one", async () => {
    listClientsForActivation
      .mockResolvedValueOnce(page([alex], { total: 2, has_more: true }))
      .mockResolvedValueOnce(page([{ ...inactiveClient }], { total: 2, has_more: false }));
    setup();
    await waitFor(() => expect(screen.getByText("Alex Naidu")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Load more/ }));
    await waitFor(() => expect(screen.getByText("Rugesh Naidu")).toBeInTheDocument());
    // The first page is still on screen.
    expect(screen.getByText("Alex Naidu")).toBeInTheDocument();
  });

  it("says a search matched nothing without implying the register is empty", async () => {
    listClientsForActivation.mockResolvedValue(page([], { total: 0, browsing: false }));
    setup();
    fireEvent.change(screen.getByLabelText("Search clients"), { target: { value: "zz" } });

    await waitFor(() =>
      expect(screen.getByText(/No client matches/)).toBeInTheDocument(), { timeout: 2000 });
    // ...and never tells the operator to go and activate them elsewhere.
    expect(screen.queryByText(/not marked active/)).not.toBeInTheDocument();
    expect(screen.queryByText("No clients yet")).not.toBeInTheDocument();
  });

  it("distinguishes an empty register from an empty filter", async () => {
    listClientsForActivation.mockResolvedValue(page([], { total: 0, browsing: true }));
    const { unmount } = setup();
    // Nothing at all: this is the only case that points at creating a client.
    await waitFor(() => expect(screen.getByText("No clients yet")).toBeInTheDocument());
    expect(screen.getByText(/created in Client Management/)).toBeInTheDocument();
    unmount();

    setup();
    await waitFor(() => expect(screen.getByText("No clients yet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Active" }));
    await waitFor(() => expect(screen.getByText("No active clients")).toBeInTheDocument());
  });

  it("never renders a failed lookup as an empty register", async () => {
    // "No clients" on a broken read is what sends an operator off to create
    // a duplicate of a client that already exists.
    listClientsForActivation.mockRejectedValue(new Error("network"));
    setup();

    await waitFor(() =>
      expect(screen.getByText("The client register could not be reached")).toBeInTheDocument());
    expect(screen.queryByText("No clients yet")).not.toBeInTheDocument();

    listClientsForActivation.mockResolvedValue(page([alex], { total: 1 }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Alex Naidu")).toBeInTheDocument());
  });
});

describe("ActivateClientDialog — responsive layout", () => {
  it("uses a bounded, non-overflowing shell with an independently scrollable body and persistent footer", async () => {
    getClientForActivation.mockResolvedValue({ client: inactiveClient });
    setup({ clientId: CLIENT_ID });
    await waitFor(() => expect(screen.getByTestId("ac-selected-client")).toBeInTheDocument());

    const shell = screen.getByTestId("activate-client-dialog");
    const cls = shell.className;
    // Viewport-bounded width and height on desktop; flex column shell.
    expect(cls).toContain("sm:max-w-[780px]");
    expect(cls).toMatch(/max-h-\[/);
    expect(cls).toContain("flex-col");
    expect(cls).toContain("overflow-hidden");

    // Body scrolls on its own and clips horizontal overflow.
    const body = shell.querySelector(".overflow-y-auto.overflow-x-hidden, .overflow-y-auto");
    expect(body?.className).toContain("overflow-y-auto");
    expect(body?.className).toContain("overflow-x-hidden");

    // Footer with Cancel + Activate stays outside the scroll container.
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const activate = screen.getByRole("button", { name: "Activate client" });
    expect(body?.contains(cancel)).toBe(false);
    expect(body?.contains(activate)).toBe(false);
  });
});
