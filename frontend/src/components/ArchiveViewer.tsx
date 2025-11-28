'use client';

import { useState, useEffect, useMemo } from 'react';
import { api } from '@/lib/api';
import type { ArchiveContent, FilePreview, ArchiveEntry } from '@/lib/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  TreeProvider,
  TreeView,
  TreeNode,
  TreeNodeTrigger,
  TreeNodeContent,
  TreeExpander,
  TreeIcon,
  TreeLabel,
} from '@/components/kibo-ui/tree';
import { Badge } from '@/components/ui/badge';

interface TreeFileNode {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  children: TreeFileNode[];
}

function buildFileTree(files: ArchiveEntry[]): TreeFileNode[] {
  const root: TreeFileNode[] = [];
  
  for (const file of files) {
    const parts = file.name.split('/').filter(Boolean);
    let currentLevel = root;
    let currentPath = '';
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLastPart = i === parts.length - 1;
      const isDir = isLastPart ? file.is_dir : true;
      
      let existing = currentLevel.find(n => n.name === part);
      
      if (!existing) {
        existing = {
          name: part,
          path: currentPath,
          isDir: isDir,
          size: isLastPart ? file.size : 0,
          children: [],
        };
        currentLevel.push(existing);
      }
      
      if (!isLastPart || isDir) {
        currentLevel = existing.children;
      }
    }
  }
  
  // Sort: folders first, then files, alphabetically
  const sortNodes = (nodes: TreeFileNode[]): TreeFileNode[] => {
    return nodes
      .map(node => ({
        ...node,
        children: sortNodes(node.children),
      }))
      .sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
      });
  };
  
  return sortNodes(root);
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileTreeNode({ node, level, isLast }: { node: TreeFileNode; level: number; isLast: boolean }) {
  const hasChildren = node.children.length > 0;
  
  return (
    <TreeNode nodeId={node.path} level={level} isLast={isLast}>
      <TreeNodeTrigger>
        <TreeExpander hasChildren={hasChildren} />
        <TreeIcon hasChildren={node.isDir} />
        <TreeLabel>{node.name}</TreeLabel>
        {!node.isDir && node.size > 0 && (
          <Badge variant="secondary" className="ml-2 text-xs">
            {formatSize(node.size)}
          </Badge>
        )}
      </TreeNodeTrigger>
      {hasChildren && (
        <TreeNodeContent hasChildren={hasChildren}>
          {node.children.map((child, idx) => (
            <FileTreeNode
              key={child.path}
              node={child}
              level={level + 1}
              isLast={idx === node.children.length - 1}
            />
          ))}
        </TreeNodeContent>
      )}
    </TreeNode>
  );
}

interface ArchiveViewerProps {
  path: string;
  filename: string;
  open: boolean;
  onClose: () => void;
}

export function ArchiveViewer({ path, filename, open, onClose }: ArchiveViewerProps) {
  const [content, setContent] = useState<ArchiveContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && path) {
      setLoading(true);
      setError(null);
      api.previewArchive(path)
        .then(setContent)
        .catch(() => setError('Failed to load archive'))
        .finally(() => setLoading(false));
    }
  }, [open, path]);

  const fileTree = useMemo(() => {
    if (!content) return [];
    return buildFileTree(content.files);
  }, [content]);

  const defaultExpanded = useMemo(() => {
    // Expand first level folders by default
    return fileTree.filter(n => n.isDir).map(n => n.path);
  }, [fileTree]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Isi Archive: {filename}
            {content && (
              <Badge variant="outline" className="ml-2">
                {content.files.length} items
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="h-[60vh]">
          {loading && <p className="text-center py-4">Loading...</p>}
          {error && <p className="text-center py-4 text-red-500">{error}</p>}
          {content && content.files.length === 0 && (
            <p className="text-center py-4 text-muted-foreground">Archive kosong atau format tidak didukung</p>
          )}
          {content && content.files.length > 0 && (
            <TreeProvider
              defaultExpandedIds={defaultExpanded}
              showLines={true}
              showIcons={true}
              selectable={false}
            >
              <TreeView>
                {fileTree.map((node, idx) => (
                  <FileTreeNode
                    key={node.path}
                    node={node}
                    level={0}
                    isLast={idx === fileTree.length - 1}
                  />
                ))}
              </TreeView>
            </TreeProvider>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

interface FileViewerProps {
  path: string;
  filename: string;
  open: boolean;
  onClose: () => void;
}

export function FileViewer({ path, filename, open, onClose }: FileViewerProps) {
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && path) {
      setLoading(true);
      api.previewFile(path)
        .then(setPreview)
        .finally(() => setLoading(false));
    }
  }, [open, path]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Preview: {filename}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="h-[60vh]">
          {loading && <p className="text-center py-4">Loading...</p>}
          {preview && !preview.is_text && (
            <p className="text-center py-4 text-muted-foreground">
              File ini bukan file teks dan tidak bisa di-preview
            </p>
          )}
          {preview && preview.is_text && preview.content && (
            <pre className="text-sm bg-muted p-4 rounded overflow-x-auto whitespace-pre-wrap">
              {preview.content}
            </pre>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
