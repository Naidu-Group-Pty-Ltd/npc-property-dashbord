import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActivateClientDialog } from "../ActivateClientDialog";

class TestResizeObserver { observe() {} unobserve() {} disconnect() {} }
Object.defineProperty(globalThis, "ResizeObserver", { writable: true, value: TestResizeObserver });

const getClientForActivation = vi.fn();
const searchClients = vi.fn();
const activateClient = vi.fn();

vi.mock("@/lib/aml/amlCasesApi", () => ({
  amlCasesApi: {
    getClientForActivation: (...a: unknown[]) => getClientForActivation(...a),
    searchClients: (...a: unknown[]) => searchClients(...a),
    activateClient: (...a: unknown[]) => activateClient(...a),
  },
}));
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
  searchClients.mockReset();
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

describe("ActivateClientDialog — search", () => {
  it("lists active and inactive clients and lets an inactive client be selected", async () => {
    searchClients.mockResolvedValue({
      clients: [
        { id: "a", label: "Alex Naidu", email: "alex@example.test", mobile: null, is_active: true, has_open_case: false },
        { ...inactiveClient },
      ],
    });
    setup();

    fireEvent.change(screen.getByLabelText("Find client"), { target: { value: "naidu" } });
    await waitFor(() => expect(searchClients).toHaveBeenCalledWith("naidu"), { timeout: 2000 });

    await waitFor(() => expect(screen.getByText("Alex Naidu")).toBeInTheDocument());
    expect(screen.getByText("Rugesh Naidu")).toBeInTheDocument();
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Inactive").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Rugesh Naidu/ }));
    await waitFor(() =>
      expect(screen.getByTestId("ac-selected-client")).toHaveTextContent("Rugesh Naidu"));
    expect(screen.getByText(/Inactive client — this client will be marked active/)).toBeInTheDocument();
    expect(screen.getByLabelText("Subject display name")).toHaveValue("Rugesh Naidu");
  });

  it("shows a no-match state without telling the user to activate the client elsewhere", async () => {
    searchClients.mockResolvedValue({ clients: [] });
    setup();

    fireEvent.change(screen.getByLabelText("Find client"), { target: { value: "zz" } });
    await waitFor(() =>
      expect(screen.getByText("No clients match that name.")).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.queryByText(/not marked active/)).not.toBeInTheDocument();
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
