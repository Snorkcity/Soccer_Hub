import React, { useMemo, useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAuthStatus,
  useListCurriculumDocuments, getListCurriculumDocumentsQueryKey,
  useAddCurriculumDocument,
  useReplaceCurriculumDocument,
  useReindexCurriculumDocument,
  useDeleteCurriculumDocument,
  CurriculumDocumentResponse,
  CurriculumDocumentInputDocType,
  CurriculumDocumentInputAgeGroup,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Plus, FileText, Trash2, RefreshCw, AlertTriangle, UploadCloud, CheckCircle2, XCircle, FileWarning } from "lucide-react";

function errMsg(e: unknown): string {
  const anyE = e as { data?: { error?: string }; error?: string; message?: string } | undefined;
  return anyE?.data?.error ?? anyE?.error ?? anyE?.message ?? "Something went wrong";
}

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] ?? result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export default function CurriculumDocuments() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: auth } = useGetAuthStatus();
  const isSuperadmin = auth?.authenticated === true && auth.user?.isSuperadmin === true;

  const { data: documents, isLoading } = useListCurriculumDocuments({
    query: {
      enabled: isSuperadmin,
      queryKey: getListCurriculumDocumentsQueryKey(),
      refetchInterval: (query) => {
        const docs = query.state.data;
        if (!docs) return false;
        return docs.some(d => d.status === "processing") ? 2000 : false;
      }
    }
  });

  const refresh = () => { void queryClient.invalidateQueries({ queryKey: getListCurriculumDocumentsQueryKey() }); };

  const addDoc = useAddCurriculumDocument({
    mutation: {
      onSuccess: (document) => {
        refresh();
        setAddOpen(false);
        if (document.status === "failed") {
          toast({
            description: `The document was saved, but indexing failed: ${document.error ?? "Unknown indexing error"}`,
            variant: "destructive",
          });
          return;
        }
        toast({ description: "Document published and ready for the Coach Assistant." });
      },
      onError: (e) => setAddErr(errMsg(e)),
    }
  });

  const replaceDoc = useReplaceCurriculumDocument({
    mutation: {
      onSuccess: (document) => {
        refresh();
        setReplaceDocId(null);
        if (document.status === "failed") {
          toast({
            description: `Replacement failed. The previous published version remains in use: ${document.error ?? "Unknown indexing error"}`,
            variant: "destructive",
          });
          return;
        }
        toast({ description: "Replacement published and ready for the Coach Assistant." });
      },
      onError: (e) => {
        refresh();
        setReplaceErr(errMsg(e));
      },
    }
  });

  const reindexDoc = useReindexCurriculumDocument({
    mutation: {
      onSuccess: (document) => {
        refresh();
        setReindexDocId(null);
        if (document.status === "failed") {
          toast({
            description: `Re-indexing failed. The previous published version remains in use: ${document.error ?? "Unknown indexing error"}`,
            variant: "destructive",
          });
          return;
        }
        toast({ description: "Document re-indexed and published." });
      },
      onError: (e) => toast({ description: errMsg(e), variant: "destructive" }),
    }
  });

  const deleteDoc = useDeleteCurriculumDocument({
    mutation: {
      onSuccess: () => { refresh(); setDeleteDocTarget(null); toast({ description: "Document deleted." }); },
      onError: (e) => setDeleteErr(errMsg(e)),
    }
  });

  // Add state
  const [addOpen, setAddOpen] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addDocType, setAddDocType] = useState<CurriculumDocumentInputDocType | "">("");
  const [addAgeGroup, setAddAgeGroup] = useState<CurriculumDocumentInputAgeGroup | "">("");
  const [addFile, setAddFile] = useState<File | null>(null);
  const [addErr, setAddErr] = useState<string | null>(null);
  const addFileInputRef = useRef<HTMLInputElement>(null);

  // Replace state
  const [replaceDocId, setReplaceDocId] = useState<string | null>(null);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [replaceErr, setReplaceErr] = useState<string | null>(null);
  const replaceFileInputRef = useRef<HTMLInputElement>(null);

  // Delete state
  const [deleteDocTarget, setDeleteDocTarget] = useState<CurriculumDocumentResponse | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  // Reindex state
  const [reindexDocId, setReindexDocId] = useState<string | null>(null);

  const isMutating = addDoc.isPending || replaceDoc.isPending || reindexDoc.isPending || deleteDoc.isPending;
  useEffect(() => {
    if (isMutating) {
      const interval = setInterval(refresh, 2000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [isMutating]);

  if (auth && !isSuperadmin) {
    return (
      <div className="space-y-6 max-w-5xl" data-testid="curriculum-page">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Curriculum Documents</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage the knowledge base for the Coach Assistant.</p>
        </div>
        <div className="p-6 border border-destructive/20 bg-destructive/5 rounded-md text-destructive">
          You do not have permission to view this page. Only superadmins can manage curriculum documents.
        </div>
      </div>
    );
  }

  const handleAddSubmit = async () => {
    setAddErr(null);
    if (!addTitle.trim() || !addDocType || !addAgeGroup || !addFile) {
      setAddErr("Please fill all fields and select a file.");
      return;
    }
    if (!addFile.name.toLowerCase().endsWith(".docx")) {
      setAddErr("Only .docx files are supported.");
      return;
    }
    if (addFile.size > MAX_FILE_SIZE) {
      setAddErr("File is too large (max 15MB).");
      return;
    }
    try {
      const base64 = await readFileAsBase64(addFile);
      addDoc.mutate({
        data: {
          title: addTitle.trim(),
          docType: addDocType,
          ageGroup: addAgeGroup,
          filename: addFile.name,
          base64,
        }
      });
    } catch (e) {
      setAddErr("Failed to read file.");
    }
  };

  const handleReplaceSubmit = async () => {
    setReplaceErr(null);
    if (!replaceDocId || !replaceFile) {
      setReplaceErr("Please select a file.");
      return;
    }
    if (!replaceFile.name.toLowerCase().endsWith(".docx")) {
      setReplaceErr("Only .docx files are supported.");
      return;
    }
    if (replaceFile.size > MAX_FILE_SIZE) {
      setReplaceErr("File is too large (max 15MB).");
      return;
    }
    try {
      const base64 = await readFileAsBase64(replaceFile);
      replaceDoc.mutate({
        id: replaceDocId,
        data: {
          filename: replaceFile.name,
          base64,
        }
      });
    } catch (e) {
      setReplaceErr("Failed to read file.");
    }
  };

  const handleDeleteSubmit = () => {
    setDeleteErr(null);
    if (!deleteDocTarget) return;
    if (deleteConfirmText !== deleteDocTarget.title) {
      setDeleteErr("Confirmation text does not match the document title.");
      return;
    }
    deleteDoc.mutate({ id: deleteDocTarget.id, data: { confirm: true } });
  };

  const docs = documents ?? [];
  const publishedDocs = docs.filter(d => d.isReady);
  const attentionDocs = docs.filter(d => d.status === "failed" || (!d.isReady && d.status !== "processing"));
  const totalChunks = publishedDocs.reduce((acc, d) => acc + d.activeChunkCount, 0);
  const isIndexing = docs.some(d => d.status === "processing");

  return (
    <div className="space-y-6 max-w-5xl" data-testid="curriculum-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Curriculum Documents</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Published curriculum is the Coach Assistant&apos;s only source of coaching content. Replacements stay private until every chunk is indexed.
          </p>
        </div>
        <Button onClick={() => {
          setAddTitle(""); setAddDocType(""); setAddAgeGroup(""); setAddFile(null); setAddErr(null); setAddOpen(true);
        }} data-testid="add-doc-btn">
          <Plus className="h-4 w-4 mr-2" /> Add Document
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card" data-testid="curriculum-summary-published">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Published</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold">{publishedDocs.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-card" data-testid="curriculum-summary-chunks">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Chunks</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold">{totalChunks}</div>
          </CardContent>
        </Card>
        <Card className="bg-card" data-testid="curriculum-summary-attention">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Needs Attention</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className={`text-2xl font-bold ${attentionDocs.length > 0 ? "text-destructive" : ""}`}>{attentionDocs.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-card" data-testid="curriculum-summary-activity">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Activity</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 flex items-center gap-2">
            {isIndexing ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="text-sm font-medium">Indexing...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-5 w-5 text-muted-foreground/50" />
                <span className="text-sm font-medium text-muted-foreground">Idle</span>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : docs.length === 0 ? (
          <div className="text-center py-12 border border-border rounded-lg bg-card/50">
            <FileText className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-foreground">No documents</h3>
            <p className="text-sm text-muted-foreground mt-1">Upload your first curriculum document to give the Assistant an approved coaching source.</p>
          </div>
        ) : (
          docs.map((doc) => {
            const safeId = doc.id.replace(/[^a-zA-Z0-9-]/g, '-');
            const hasDraft = doc.filename && (!doc.isReady || doc.status === "failed" || doc.status === "processing" || doc.versionNumber !== doc.activeVersionNumber);
            const isLatestFailed = doc.status === "failed";
            const isProcessing = doc.status === "processing";

            return (
              <Card key={doc.id} className="overflow-hidden bg-card" data-testid={`doc-row-${safeId}`}>
                <div className="flex flex-col md:flex-row">
                  <div className="flex-1 p-5 border-b md:border-b-0 md:border-r border-border">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-base">{doc.title}</h3>
                          <Badge variant="outline" className="text-[10px] uppercase tracking-wider">{doc.docType.replace('_', ' ')}</Badge>
                          <Badge variant="outline" className="text-[10px] uppercase tracking-wider">{doc.ageGroup}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground font-mono bg-muted/50 inline-block px-1.5 py-0.5 rounded">
                          {doc.key}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="ghost" size="sm" title="Re-index active document"
                           aria-label={`Re-index ${doc.title}`}
                          disabled={reindexDoc.isPending || isProcessing || !doc.isReady}
                          onClick={() => setReindexDocId(doc.id)}
                          data-testid={`reindex-btn-${safeId}`}
                        >
                          <RefreshCw className="h-4 w-4 text-muted-foreground" />
                        </Button>
                        <Button
                          variant="ghost" size="sm" title="Replace document"
                           aria-label={`Replace ${doc.title}`}
                          disabled={isProcessing}
                          onClick={() => { setReplaceErr(null); setReplaceFile(null); setReplaceDocId(doc.id); }}
                          data-testid={`replace-btn-${safeId}`}
                        >
                          <UploadCloud className="h-4 w-4 text-muted-foreground" />
                        </Button>
                        <Button
                          variant="ghost" size="sm" title="Delete document"
                           aria-label={`Delete ${doc.title}`}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          disabled={deleteDoc.isPending || isProcessing}
                          onClick={() => { setDeleteErr(null); setDeleteConfirmText(""); setDeleteDocTarget(doc); }}
                          data-testid={`delete-btn-${safeId}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {/* Active / Published Version */}
                      <div className={`rounded-md border p-3 ${doc.isReady ? "border-primary/20 bg-primary/5" : "border-border bg-muted/30"}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
                            {doc.isReady ? (
                              <><CheckCircle2 className="h-3.5 w-3.5 text-primary" /> <span className="text-primary" data-testid={`published-status-${safeId}`}>Published Version</span></>
                            ) : (
                              <span className="text-muted-foreground" data-testid={`published-status-${safeId}`}>No Published Version</span>
                            )}
                          </div>
                          {doc.isReady && (
                            <Badge variant="secondary" className="text-[10px] font-mono">v{doc.activeVersionNumber}</Badge>
                          )}
                        </div>

                        {doc.isReady ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 text-xs">
                            <div><span className="text-muted-foreground">File:</span> <span className="font-medium truncate block">{doc.activeFilename}</span></div>
                            <div><span className="text-muted-foreground">Published:</span> <span className="font-medium">{formatDate(doc.publishedAt)}</span></div>
                            <div><span className="text-muted-foreground">Chunks:</span> <span className="font-medium">{doc.activeChunkCount}</span></div>
                            <div><span className="text-muted-foreground">Embedded:</span> <span className="font-medium">{doc.activeEmbeddedCount}</span></div>
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground">The assistant has no content for this document yet.</div>
                        )}
                      </div>

                      {/* Latest Attempt / Draft Version */}
                      {hasDraft && (
                        <div
                          className={`rounded-md border p-3 ${isLatestFailed ? "border-destructive/30 bg-destructive/5" : isProcessing ? "border-blue-500/30 bg-blue-500/5" : "border-border bg-muted/30"}`}
                          data-testid={`latest-status-${safeId}`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
                              {isLatestFailed ? (
                                <><XCircle className="h-3.5 w-3.5 text-destructive" /> <span className="text-destructive">Upload Failed</span></>
                              ) : isProcessing ? (
                                <><Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" /> <span className="text-blue-600 dark:text-blue-400">Indexing...</span></>
                              ) : (
                                <span className="text-muted-foreground">Latest Upload</span>
                              )}
                            </div>
                            <Badge variant="outline" className="text-[10px] font-mono">v{doc.versionNumber}</Badge>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 text-xs mb-2">
                            <div><span className="text-muted-foreground">File:</span> <span className="font-medium truncate block">{doc.filename}</span></div>
                            <div><span className="text-muted-foreground">Uploaded:</span> <span className="font-medium">{formatDate(doc.uploadedAt)}</span></div>
                            {(!isProcessing && !isLatestFailed) && (
                              <>
                                <div><span className="text-muted-foreground">Chunks:</span> <span className="font-medium">{doc.chunkCount}</span></div>
                                <div><span className="text-muted-foreground">Embedded:</span> <span className="font-medium">{doc.embeddedCount}</span></div>
                              </>
                            )}
                          </div>

                          {isLatestFailed && doc.error && (
                            <div className="mt-2 text-xs text-destructive bg-destructive/10 p-2 rounded border border-destructive/20 font-mono overflow-x-auto whitespace-pre-wrap">
                              <span data-testid={`latest-error-${safeId}`}>{doc.error}</span>
                            </div>
                          )}
                          {isLatestFailed && doc.isReady && (
                            <div className="mt-2 text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              The previously published version remains active and in use.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Add Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md" data-testid="add-dialog">
          <DialogHeader>
            <DialogTitle>Add Document</DialogTitle>
            <DialogDescription>
              Upload a new `.docx` document to the curriculum. Original files are not retained; the text is extracted and indexed immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
               <label className="text-xs font-medium" htmlFor="curriculum-add-title">Title</label>
              <Input
                id="curriculum-add-title"
                value={addTitle} onChange={e => setAddTitle(e.target.value)}
                placeholder="e.g. U14 Attacking Principles"
                data-testid="add-title-input"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                 <label className="text-xs font-medium" htmlFor="curriculum-add-type">Document Type</label>
                <select
                  id="curriculum-add-type"
                  className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={addDocType}
                  onChange={e => setAddDocType(e.target.value as CurriculumDocumentInputDocType)}
                  data-testid="add-type-select"
                >
                  <option value="" disabled>Select...</option>
                  {Object.values(CurriculumDocumentInputDocType).map(t => (
                    <option key={t} value={t}>{t.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                 <label className="text-xs font-medium" htmlFor="curriculum-add-age">Age Group</label>
                <select
                  id="curriculum-add-age"
                  className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={addAgeGroup}
                  onChange={e => setAddAgeGroup(e.target.value as CurriculumDocumentInputAgeGroup)}
                  data-testid="add-age-select"
                >
                  <option value="" disabled>Select...</option>
                  {Object.values(CurriculumDocumentInputAgeGroup).map(a => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
               <label className="text-xs font-medium" htmlFor="curriculum-add-file">File (.docx max 15MB)</label>
              <div className="flex items-center gap-2">
                <Input
                  type="file"
                  id="curriculum-add-file"
                  accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  ref={addFileInputRef}
                  onChange={e => setAddFile(e.target.files?.[0] ?? null)}
                  className="cursor-pointer file:cursor-pointer file:text-sm file:font-medium"
                  data-testid="add-file-input"
                />
              </div>
            </div>
            {addErr && <p className="text-sm text-destructive" data-testid="add-error">{addErr}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={addDoc.isPending}>Cancel</Button>
            <Button onClick={handleAddSubmit} disabled={addDoc.isPending} data-testid="add-submit-btn">
              {addDoc.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Upload & Index
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Replace Dialog */}
      <Dialog open={replaceDocId !== null} onOpenChange={(open) => !open && setReplaceDocId(null)}>
        <DialogContent className="sm:max-w-md" data-testid="replace-dialog">
          <DialogHeader>
            <DialogTitle>Replace Document</DialogTitle>
            <DialogDescription>
              Upload a new `.docx` file for this document. The current published version will remain active until the new file is fully indexed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
               <label className="text-xs font-medium" htmlFor="curriculum-replace-file">New File (.docx max 15MB)</label>
              <Input
                type="file"
                id="curriculum-replace-file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                ref={replaceFileInputRef}
                onChange={e => setReplaceFile(e.target.files?.[0] ?? null)}
                className="cursor-pointer file:cursor-pointer file:text-sm file:font-medium"
                data-testid="replace-file-input"
              />
            </div>
            {replaceErr && <p className="text-sm text-destructive" data-testid="replace-error">{replaceErr}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplaceDocId(null)} disabled={replaceDoc.isPending}>Cancel</Button>
            <Button onClick={handleReplaceSubmit} disabled={replaceDoc.isPending} data-testid="replace-submit-btn">
              {replaceDoc.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Upload Replacement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reindex Dialog */}
      <Dialog open={reindexDocId !== null} onOpenChange={(open) => !open && setReindexDocId(null)}>
        <DialogContent className="sm:max-w-sm" data-testid="reindex-dialog">
          <DialogHeader>
            <DialogTitle>Re-index Document?</DialogTitle>
            <DialogDescription>
              This will re-process the raw text already stored in the system. Use this if the AI Assistant is missing information from this document.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setReindexDocId(null)} disabled={reindexDoc.isPending}>Cancel</Button>
            <Button
              onClick={() => { if(reindexDocId) reindexDoc.mutate({ id: reindexDocId, data: {} }) }}
              disabled={reindexDoc.isPending}
              data-testid="reindex-confirm-btn"
            >
              {reindexDoc.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Start Re-index
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteDocTarget !== null} onOpenChange={(open) => !open && setDeleteDocTarget(null)}>
        <DialogContent className="sm:max-w-md border-destructive/20" data-testid="delete-dialog">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <FileWarning className="h-5 w-5" /> Permanent Deletion
            </DialogTitle>
            <DialogDescription className="text-foreground">
              This will permanently delete <strong>{deleteDocTarget?.title}</strong> and all its chunks. The Assistant will immediately lose access to this knowledge.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
              Only this document will be removed. Other curriculum documents are not affected.
            </div>
            <div className="space-y-1.5">
               <label className="text-xs font-medium text-muted-foreground" htmlFor="curriculum-delete-confirm">
                Type <span className="font-semibold text-foreground">{deleteDocTarget?.title}</span> to confirm
              </label>
              <Input
                id="curriculum-delete-confirm"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={deleteDocTarget?.title}
                data-testid="delete-confirm-input"
              />
            </div>
            {deleteErr && <p className="text-sm text-destructive font-medium" data-testid="delete-error">{deleteErr}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDocTarget(null)} disabled={deleteDoc.isPending}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleDeleteSubmit}
              disabled={deleteDoc.isPending || deleteConfirmText !== deleteDocTarget?.title}
              data-testid="delete-submit-btn"
            >
              {deleteDoc.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete Document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
