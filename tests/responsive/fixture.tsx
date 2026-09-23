import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiTokensClient } from "@/app/app/settings/api-tokens/_components/ApiTokensClient";
import { ConnectionsClient } from "@/components/connections/ConnectionsClient";
import { NewContactDialog } from "@/components/contacts/NewContactDialog";
import { NewLeadDialog } from "@/components/kanban/NewLeadDialog";
import { FormularioDeTarefa } from "@/app/app/tasks/_components/FormularioDeTarefa";
import { CreateSourceDialog } from "@/app/app/webhooks/_components/CreateSourceDialog";
import { NewFlowDialog } from "@/app/app/ai/followups/_components/NewFlowDialog";
import { MobileSidebar } from "@/components/shell/MobileSidebar";
import { Sidebar } from "@/components/shell/Sidebar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Toaster } from "sonner";
import "@/app/globals.css";

const long = "ConexaoSemEspacos".repeat(12);
function Primitives() {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-4">
      <Button onClick={() => setOpen(true)}>Formulário longo</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{long}</DialogTitle>
            <DialogDescription>Descrição extensa para testar limites.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
            {Array.from({ length: 20 }, (_, i) => (
              <label key={i} className="block">
                Campo {i}
                <Input />
              </label>
            ))}
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Cancelar</Button>
              <Button>Salvar alterações do formulário</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button>Confirmação</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir registro?</AlertDialogTitle>
            <AlertDialogDescription>{long}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction>Confirmar exclusão definitivamente</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Sheet>
        <SheetTrigger asChild>
          <Button>Abrir painel</Button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{long}</SheetTitle>
            <SheetDescription>Detalhes do registro</SheetDescription>
          </SheetHeader>
          {Array.from({ length: 20 }, (_, i) => (
            <p key={i}>{long}</p>
          ))}
          <SheetFooter>
            <Button>Salvar painel</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <Popover>
        <PopoverTrigger asChild>
          <Button>Filtro</Button>
        </PopoverTrigger>
        <PopoverContent>
          {long}
          <Input aria-label="Filtro de texto" />
        </PopoverContent>
      </Popover>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>Menu</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {Array.from({ length: 30 }, (_, i) => (
            <DropdownMenuItem key={i}>
              {i} {long}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Select>
        <SelectTrigger aria-label="Responsável">
          <SelectValue placeholder="Responsável" />
        </SelectTrigger>
        <SelectContent>
          {Array.from({ length: 30 }, (_, i) => (
            <SelectItem key={i} value={String(i)}>
              {i} {long}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Tabs defaultValue="0">
        <TabsList>
          {Array.from({ length: 8 }, (_, i) => (
            <TabsTrigger key={i} value={String(i)}>
              Configuração {i}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Card>
        <Table>
          <TableBody>
            <TableRow>
              {Array.from({ length: 8 }, (_, i) => (
                <TableCell key={i}>{long}</TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
function Forms() {
  const [active, setActive] = useState("");
  const change = (open: boolean) => {
    if (!open) setActive("");
  };
  return (
    <div>
      {["Contato", "Lead", "Tarefa", "Webhook", "Follow-up"].map((name) => (
        <Button key={name} onClick={() => setActive(name)}>
          {name}
        </Button>
      ))}
      <NewContactDialog open={active === "Contato"} onOpenChange={change} />
      <NewLeadDialog
        open={active === "Lead"}
        onOpenChange={change}
        pipelineId="fixture"
        stages={[]}
      />
      <FormularioDeTarefa
        aberto={active === "Tarefa"}
        aoMudarAbertura={change}
        aoSalvar={async () => {}}
      />
      <CreateSourceDialog open={active === "Webhook"} onOpenChange={change} onCreated={() => {}} />
      <NewFlowDialog open={active === "Follow-up"} onOpenChange={change} />
    </div>
  );
}
function Navigation() {
  return (
    <div className="flex min-w-0">
      <div className="hidden md:block">
        <Sidebar collapsed={false} />
      </div>
      <div className="min-w-0 flex-1">
        <MobileSidebar />
        <p>Conteúdo da página</p>
      </div>
    </div>
  );
}
const view = new URLSearchParams(location.search).get("view");
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <main className={view === "navigation" ? "min-w-0" : "min-w-0 p-3 sm:p-6"}>
      {view === "forms" ? (
        <Forms />
      ) : view === "navigation" ? (
        <Navigation />
      ) : view === "tokens" ? (
        <ApiTokensClient />
      ) : view === "connections" ? (
        <ConnectionsClient wahaConfigured={false} />
      ) : (
        <Primitives />
      )}
    </main>
    <Toaster />
  </QueryClientProvider>,
);
