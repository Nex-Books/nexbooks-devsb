'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Badge, Box, Button, Flex, FormLabel, Icon, IconButton, Input, Modal, ModalBody,
  ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, NumberInput,
  NumberInputField, Select, Spinner, Tab, Table, TabList, TabPanel, TabPanels, Tabs,
  Tbody, Td, Text, Th, Thead, Tooltip, Tr, useDisclosure, useToast,
} from '@chakra-ui/react';
import {
  MdAdd, MdAttachFile, MdDelete, MdOpenInNew, MdRefresh, MdUploadFile, MdVisibility,
} from 'react-icons/md';
import { supabase } from 'lib/supabase';
import { useAuth } from 'context/AuthContext';

const API = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || 'http://localhost:8000';

const fmt = (n: number) =>
  '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2 });

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

interface LineItem {
  description: string;
  hsn_sac_code?: string;
  quantity: number;
  rate: number;
  amount: number;
  gst_rate: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
}

interface Invoice {
  id: string;
  invoice_number: string;
  vendor_name: string;
  vendor_gstin?: string;
  invoice_date: string;
  due_date?: string;
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  total_amount: number;
  invoice_type: string;
  status: string;
  ai_extracted: boolean;
  line_items?: LineItem[];
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'yellow',
  booked: 'blue',
  paid: 'green',
  cancelled: 'red',
};

interface DraftLine {
  description: string;
  hsn_sac_code: string;
  quantity: number;
  rate: number;
  gst_rate: number;
}

const emptyDraftLine = (): DraftLine => ({
  description: '', hsn_sac_code: '', quantity: 1, rate: 0, gst_rate: 18,
});

export default function InvoicesPage() {
  const { user } = useAuth();
  const toast = useToast();
  const searchParams = useSearchParams();
  const { isOpen: isDetailOpen, onOpen: onDetailOpen, onClose: onDetailClose } = useDisclosure();
  const { isOpen: isUploadOpen, onOpen: onUploadOpen, onClose: onUploadClose } = useDisclosure();
  const { isOpen: isCreateOpen, onOpen: onCreateOpen, onClose: onCreateClose } = useDisclosure();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [tabIndex, setTabIndex] = useState(0);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadHint, setUploadHint] = useState<'purchase' | 'sale'>('purchase');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<Record<string, unknown> | null>(null);

  // Manual create state
  const [draftType, setDraftType] = useState<'purchase' | 'sale'>('purchase');
  const [draftNumber, setDraftNumber] = useState('');
  const [draftPartyName, setDraftPartyName] = useState('');
  const [draftPartyGstin, setDraftPartyGstin] = useState('');
  const [draftDate, setDraftDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [draftDueDate, setDraftDueDate] = useState('');
  const [draftSupply, setDraftSupply] = useState<'intrastate' | 'interstate'>('intrastate');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([emptyDraftLine()]);
  const [creating, setCreating] = useState(false);

  const invType = tabIndex === 0 ? 'purchase' : 'sale';

  const getAuthHeader = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  };

  const loadInvoices = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const headers = await getAuthHeader();
      const params = new URLSearchParams({
        user_id: user.id,
        invoice_type: invType,
        page: String(page),
        limit: '20',
      });
      const res = await fetch(`${API}/finance/invoices?${params}`, { headers });
      const data = await res.json();
      setInvoices(data.data || []);
      setTotal(data.total || 0);
      setTotalPages(data.total_pages || 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [user, invType, page]);

  useEffect(() => { loadInvoices(); }, [loadInvoices]);

  const updateStatus = async (id: string, status: string) => {
    try {
      const headers = await getAuthHeader();
      await fetch(`${API}/finance/invoices/${id}/status?status=${status}&user_id=${user?.id}`, {
        method: 'PATCH',
        headers,
      });
      toast({ title: `Status updated to ${status}`, status: 'success', duration: 2000 });
      loadInvoices();
    } catch {
      toast({ title: 'Failed to update status', status: 'error', duration: 2000 });
    }
  };

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const headers = await getAuthHeader();
      const form = new FormData();
      form.append('file', uploadFile);
      form.append('invoice_type_hint', uploadHint);
      if (user?.id) form.append('user_id', user.id);

      const res = await fetch(`${API}/api/ai/upload-invoice`, {
        method: 'POST',
        headers,
        body: form,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setUploadResult(data);
      toast({ title: '✅ Invoice processed!', description: 'Journal entry recorded.', status: 'success', duration: 3000 });
      loadInvoices();
    } catch (e: unknown) {
      toast({ title: 'Upload failed', description: (e as Error).message, status: 'error', duration: 3000 });
    } finally {
      setUploading(false);
    }
  };

  const viewDetail = (inv: Invoice) => {
    setSelectedInvoice(inv);
    onDetailOpen();
  };

  // ── Manual create helpers ────────────────────────────────────────────────
  const updateDraftLine = (idx: number, patch: Partial<DraftLine>) => {
    setDraftLines(lines => lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const addDraftLine = () => setDraftLines(lines => [...lines, emptyDraftLine()]);
  const removeDraftLine = (idx: number) =>
    setDraftLines(lines => (lines.length > 1 ? lines.filter((_, i) => i !== idx) : lines));

  const resetDraft = () => {
    setDraftType(invType);
    setDraftNumber('');
    setDraftPartyName('');
    setDraftPartyGstin('');
    setDraftDate(new Date().toISOString().slice(0, 10));
    setDraftDueDate('');
    setDraftSupply('intrastate');
    setDraftLines([emptyDraftLine()]);
  };

  const openCreateModal = () => {
    resetDraft();
    onCreateOpen();
  };

  // Deep link support: /app/invoices?create=1 opens the manual create modal
  // immediately (used by the Dashboard "Add Invoice" quick action).
  useEffect(() => {
    if (searchParams?.get('create') === '1') {
      openCreateModal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const computedLines = draftLines.map(l => {
    const amount = round2(l.quantity * l.rate);
    const gstAmount = round2((amount * l.gst_rate) / 100);
    const cgst = draftSupply === 'intrastate' ? round2(gstAmount / 2) : 0;
    const sgst = draftSupply === 'intrastate' ? round2(gstAmount / 2) : 0;
    const igst = draftSupply === 'interstate' ? gstAmount : 0;
    return { ...l, amount, gstAmount, cgst, sgst, igst };
  });
  const draftSubtotal = round2(computedLines.reduce((s, l) => s + l.amount, 0));
  const draftCgst = round2(computedLines.reduce((s, l) => s + l.cgst, 0));
  const draftSgst = round2(computedLines.reduce((s, l) => s + l.sgst, 0));
  const draftIgst = round2(computedLines.reduce((s, l) => s + l.igst, 0));
  const draftTotal = round2(draftSubtotal + draftCgst + draftSgst + draftIgst);

  const handleCreateInvoice = async () => {
    if (!draftNumber.trim() || !draftPartyName.trim()) {
      toast({ title: 'Invoice # and party name are required', status: 'warning', duration: 2500 });
      return;
    }
    if (computedLines.some(l => !l.description.trim())) {
      toast({ title: 'Every line item needs a description', status: 'warning', duration: 2500 });
      return;
    }
    setCreating(true);
    try {
      const headers = { ...(await getAuthHeader()), 'Content-Type': 'application/json' };
      const body = {
        invoice_number: draftNumber.trim(),
        vendor_name: draftPartyName.trim(),
        vendor_gstin: draftPartyGstin.trim() || null,
        invoice_date: draftDate,
        due_date: draftDueDate || null,
        subtotal: draftSubtotal,
        cgst: draftCgst,
        sgst: draftSgst,
        igst: draftIgst,
        total_amount: draftTotal,
        invoice_type: draftType,
        status: 'pending',
        ai_extracted: false,
        line_items: computedLines.map(l => ({
          description: l.description,
          hsn_sac_code: l.hsn_sac_code || null,
          quantity: l.quantity,
          rate: l.rate,
          amount: l.amount,
          gst_rate: l.gst_rate,
          cgst_amount: l.cgst,
          sgst_amount: l.sgst,
          igst_amount: l.igst,
        })),
      };
      const params = new URLSearchParams(user?.id ? { user_id: user.id } : {});
      const res = await fetch(`${API}/finance/invoices?${params}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: `${draftType === 'purchase' ? 'Purchase' : 'Sales'} invoice created`, status: 'success', duration: 2500 });
      onCreateClose();
      setTabIndex(draftType === 'purchase' ? 0 : 1);
      setPage(1);
      loadInvoices();
    } catch (e: unknown) {
      toast({ title: 'Failed to create invoice', description: (e as Error).message, status: 'error', duration: 3000 });
    } finally {
      setCreating(false);
    }
  };

  const InvoiceTable = ({ invList }: { invList: Invoice[] }) => (
    <Box bg="white" borderRadius="14px" border="1px solid" borderColor="gray.200" overflow="hidden">
      <Table size="sm" variant="simple">
        <Thead bg="gray.50">
          <Tr>
            <Th fontSize="11px" color="gray.500" py="12px">Invoice #</Th>
            <Th fontSize="11px" color="gray.500">{invType === 'purchase' ? 'Vendor' : 'Customer'}</Th>
            <Th fontSize="11px" color="gray.500">Date</Th>
            <Th isNumeric fontSize="11px" color="gray.500">Subtotal</Th>
            <Th isNumeric fontSize="11px" color="gray.500">GST</Th>
            <Th isNumeric fontSize="11px" color="gray.500">Total</Th>
            <Th fontSize="11px" color="gray.500">Status</Th>
            <Th fontSize="11px" color="gray.500" w="80px">Actions</Th>
          </Tr>
        </Thead>
        <Tbody>
          {invList.map(inv => {
            const gst = (inv.cgst || 0) + (inv.sgst || 0) + (inv.igst || 0);
            return (
              <Tr key={inv.id} _hover={{ bg: 'gray.50' }}>
                <Td fontSize="xs" fontFamily="mono" color="gray.700" fontWeight="600">
                  <Flex align="center" gap="6px">
                    {inv.invoice_number}
                    {inv.ai_extracted && (
                      <Badge fontSize="9px" colorScheme="purple" borderRadius="4px">AI</Badge>
                    )}
                  </Flex>
                </Td>
                <Td fontSize="sm" color="gray.800">
                  <Text fontWeight="500" noOfLines={1}>{inv.vendor_name}</Text>
                  {inv.vendor_gstin && (
                    <Text fontSize="10px" color="gray.400" fontFamily="mono">{inv.vendor_gstin}</Text>
                  )}
                </Td>
                <Td fontSize="xs" color="gray.500">{inv.invoice_date}</Td>
                <Td isNumeric fontSize="xs" fontFamily="mono">{fmt(inv.subtotal)}</Td>
                <Td isNumeric fontSize="xs" fontFamily="mono" color={gst > 0 ? 'orange.600' : 'gray.400'}>
                  {gst > 0 ? fmt(gst) : '—'}
                </Td>
                <Td isNumeric fontSize="sm" fontFamily="mono" fontWeight="700" color="gray.800">
                  {fmt(inv.total_amount)}
                </Td>
                <Td>
                  <Select
                    size="xs" value={inv.status} w="100px" borderRadius="6px"
                    onChange={e => updateStatus(inv.id, e.target.value)}
                    color={STATUS_COLOR[inv.status] ? `${STATUS_COLOR[inv.status]}.700` : 'gray.700'}
                    fontSize="11px"
                  >
                    <option value="pending">Pending</option>
                    <option value="booked">Booked</option>
                    <option value="paid">Paid</option>
                    <option value="cancelled">Cancelled</option>
                  </Select>
                </Td>
                <Td>
                  <IconButton aria-label="View" icon={<MdVisibility />} size="xs"
                    variant="ghost" onClick={() => viewDetail(inv)} />
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>
      {total > 0 && (
        <Flex px="20px" py="12px" align="center" justify="space-between" borderTop="1px solid" borderColor="gray.100">
          <Text fontSize="xs" color="gray.500">{invList.length} of {total} invoices</Text>
          <Flex gap="6px">
            <Button size="xs" variant="outline" isDisabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
            <Button size="xs" variant="outline" isDisabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </Flex>
        </Flex>
      )}
    </Box>
  );

  return (
    <Box bg="gray.50" minH="100%">
      {/* Header */}
      <Flex px={{ base: '20px', md: '32px' }} pt="28px" pb="20px" bg="white" borderBottom="1px solid" borderColor="gray.200" align="center" justify="space-between">
        <Box>
          <Text fontSize="xl" fontWeight="800" color="gray.800" letterSpacing="-0.5px">Invoices</Text>
          <Text fontSize="sm" color="gray.500" mt="2px">Manage purchase bills and sales invoices</Text>
        </Box>
        <Button size="sm" variant="outline" onClick={() => window.print()} className="no-print">
          Print Invoices
        </Button>
      </Flex>
      <Flex px={{ base: '20px', md: '32px' }} py="12px" align="center" justify="end" bg="white">
          <Flex gap="8px">
            <IconButton aria-label="Refresh" icon={<MdRefresh />} size="sm" variant="ghost"
              onClick={loadInvoices} isLoading={loading} />
            <Button leftIcon={<MdAdd />} size="sm" variant="outline" borderColor="#155740"
              color="#155740" borderRadius="10px" onClick={openCreateModal}>
              Create Invoice
            </Button>
            <Button leftIcon={<MdUploadFile />} size="sm" bg="#155740" color="white"
              _hover={{ bg: '#1a7a57' }} borderRadius="10px" onClick={onUploadOpen}>
              Upload Invoice
            </Button>
          </Flex>
        </Flex>

      {/* Tabs */}
      <Box px={{ base: '20px', md: '32px' }} py="20px">
        <Tabs colorScheme="green" index={tabIndex} onChange={i => { setTabIndex(i); setPage(1); }}>
          <TabList mb="16px" borderBottom="2px solid" borderColor="gray.200">
            <Tab fontSize="sm" fontWeight="600" color="gray.500"
              _selected={{ color: '#155740', borderColor: '#155740' }}>
              Purchase Invoices
            </Tab>
            <Tab fontSize="sm" fontWeight="600" color="gray.500"
              _selected={{ color: '#155740', borderColor: '#155740' }}>
              Sales Invoices
            </Tab>
          </TabList>
          <TabPanels>
            <TabPanel p="0">
              {loading ? (
                <Flex justify="center" py="60px"><Spinner size="lg" color="#155740" thickness="3px" /></Flex>
              ) : invoices.length === 0 ? (
                <Flex direction="column" align="center" py="60px" gap="12px"
                  bg="white" borderRadius="14px" border="1px solid" borderColor="gray.200">
                  <Text color="gray.500">No purchase invoices yet</Text>
                  <Flex gap="10px">
                    <Button size="sm" variant="outline" borderColor="#155740" color="#155740"
                      leftIcon={<MdAdd />} onClick={openCreateModal}>
                      Create Manually
                    </Button>
                    <Button size="sm" bg="#155740" color="white" _hover={{ bg: '#1a7a57' }}
                      leftIcon={<MdUploadFile />} onClick={onUploadOpen}>
                      Upload First Invoice
                    </Button>
                  </Flex>
                </Flex>
              ) : <InvoiceTable invList={invoices} />}
            </TabPanel>
            <TabPanel p="0">
              {loading ? (
                <Flex justify="center" py="60px"><Spinner size="lg" color="#155740" thickness="3px" /></Flex>
              ) : invoices.length === 0 ? (
                <Flex direction="column" align="center" py="60px" gap="12px"
                  bg="white" borderRadius="14px" border="1px solid" borderColor="gray.200">
                  <Text color="gray.500">No sales invoices yet</Text>
                  <Button size="sm" variant="outline" borderColor="#155740" color="#155740"
                    leftIcon={<MdAdd />} onClick={openCreateModal}>
                    Create Manually
                  </Button>
                </Flex>
              ) : <InvoiceTable invList={invoices} />}
            </TabPanel>
          </TabPanels>
        </Tabs>
      </Box>

      {/* Detail Modal */}
      {selectedInvoice && (
        <Modal isOpen={isDetailOpen} onClose={onDetailClose} size="xl">
          <ModalOverlay backdropFilter="blur(4px)" />
          <ModalContent borderRadius="16px">
            <ModalHeader fontSize="md" fontWeight="700">
              Invoice — {selectedInvoice.invoice_number}
            </ModalHeader>
            <ModalCloseButton />
            <ModalBody pb="6">
              <Flex gap="16px" wrap="wrap" mb="16px">
                <Box flex="1" minW="160px">
                  <Text fontSize="xs" color="gray.500">Vendor</Text>
                  <Text fontSize="sm" fontWeight="600">{selectedInvoice.vendor_name}</Text>
                  {selectedInvoice.vendor_gstin && (
                    <Text fontSize="xs" color="gray.400" fontFamily="mono">{selectedInvoice.vendor_gstin}</Text>
                  )}
                </Box>
                <Box>
                  <Text fontSize="xs" color="gray.500">Date</Text>
                  <Text fontSize="sm" fontWeight="600">{selectedInvoice.invoice_date}</Text>
                </Box>
                <Box>
                  <Text fontSize="xs" color="gray.500">Status</Text>
                  <Badge colorScheme={STATUS_COLOR[selectedInvoice.status] || 'gray'}>
                    {selectedInvoice.status}
                  </Badge>
                </Box>
              </Flex>

              {/* GST Summary */}
              <Box bg="gray.50" borderRadius="10px" p="14px" mb="16px">
                <Flex justify="space-between" wrap="wrap" gap="12px">
                  <Box><Text fontSize="xs" color="gray.500">Subtotal</Text>
                    <Text fontSize="sm" fontWeight="600" fontFamily="mono">{fmt(selectedInvoice.subtotal)}</Text></Box>
                  {selectedInvoice.cgst > 0 && <Box><Text fontSize="xs" color="gray.500">CGST</Text>
                    <Text fontSize="sm" fontFamily="mono" color="orange.600">{fmt(selectedInvoice.cgst)}</Text></Box>}
                  {selectedInvoice.sgst > 0 && <Box><Text fontSize="xs" color="gray.500">SGST</Text>
                    <Text fontSize="sm" fontFamily="mono" color="orange.600">{fmt(selectedInvoice.sgst)}</Text></Box>}
                  {selectedInvoice.igst > 0 && <Box><Text fontSize="xs" color="gray.500">IGST</Text>
                    <Text fontSize="sm" fontFamily="mono" color="orange.600">{fmt(selectedInvoice.igst)}</Text></Box>}
                  <Box><Text fontSize="xs" color="gray.500">Total</Text>
                    <Text fontSize="md" fontWeight="800" color="#155740" fontFamily="mono">{fmt(selectedInvoice.total_amount)}</Text></Box>
                </Flex>
              </Box>

              {selectedInvoice.line_items && selectedInvoice.line_items.length > 0 && (
                <Box>
                  <Text fontSize="xs" fontWeight="600" color="gray.600" mb="8px">Line Items</Text>
                  <Table size="sm">
                    <Thead bg="gray.50">
                      <Tr>
                        <Th fontSize="10px">Description</Th>
                        <Th fontSize="10px">HSN/SAC</Th>
                        <Th isNumeric fontSize="10px">Qty</Th>
                        <Th isNumeric fontSize="10px">Rate</Th>
                        <Th isNumeric fontSize="10px">GST%</Th>
                        <Th isNumeric fontSize="10px">Amount</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {selectedInvoice.line_items.map((li, i) => (
                        <Tr key={i}>
                          <Td fontSize="xs">{li.description}</Td>
                          <Td fontSize="xs" fontFamily="mono" color="gray.500">{li.hsn_sac_code || '—'}</Td>
                          <Td isNumeric fontSize="xs">{li.quantity}</Td>
                          <Td isNumeric fontSize="xs" fontFamily="mono">{fmt(li.rate)}</Td>
                          <Td isNumeric fontSize="xs" color="orange.600">{li.gst_rate}%</Td>
                          <Td isNumeric fontSize="xs" fontFamily="mono" fontWeight="600">{fmt(li.amount)}</Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                </Box>
              )}
            </ModalBody>
          </ModalContent>
        </Modal>
      )}

      {/* Upload Modal */}
      <Modal isOpen={isUploadOpen} onClose={onUploadClose} size="lg">
        <ModalOverlay backdropFilter="blur(4px)" />
        <ModalContent borderRadius="16px">
          <ModalHeader fontSize="md" fontWeight="700">Upload Invoice</ModalHeader>
          <ModalCloseButton />
          <ModalBody pb="6">
            <Flex direction="column" gap="14px">
              <Box>
                <Text fontSize="xs" fontWeight="600" color="gray.600" mb="6px">Invoice Type</Text>
                <Flex gap="10px">
                  {(['purchase', 'sale'] as const).map(t => (
                    <Button key={t} size="sm" variant={uploadHint === t ? 'solid' : 'outline'}
                      colorScheme="green" borderRadius="8px" onClick={() => setUploadHint(t)} textTransform="capitalize">
                      {t === 'purchase' ? '🛒 Purchase' : '💰 Sale'}
                    </Button>
                  ))}
                </Flex>
              </Box>

              <Box
                border="2px dashed" borderColor={uploadFile ? '#155740' : 'gray.300'}
                borderRadius="12px" p="24px" textAlign="center" cursor="pointer"
                bg={uploadFile ? 'green.50' : 'gray.50'}
                transition="all 0.2s"
                onClick={() => document.getElementById('inv-upload-input')?.click()}
              >
                <Icon as={MdAttachFile} w="28px" h="28px" color={uploadFile ? '#155740' : 'gray.400'} mb="8px" />
                {uploadFile ? (
                  <Text fontSize="sm" fontWeight="600" color="#155740">{uploadFile.name}</Text>
                ) : (
                  <>
                    <Text fontSize="sm" color="gray.500">Click to select PDF or image</Text>
                    <Text fontSize="xs" color="gray.400" mt="4px">PDF, JPG, PNG, WebP supported</Text>
                  </>
                )}
                <input id="inv-upload-input" type="file" style={{ display: 'none' }}
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  onChange={e => setUploadFile(e.target.files?.[0] || null)} />
              </Box>

              {uploadResult && (
                <Box bg="green.50" borderRadius="10px" p="14px" border="1px solid" borderColor="green.200">
                  <Text fontSize="xs" fontWeight="700" color="#155740" mb="6px">✅ Invoice Processed</Text>
                  <Text fontSize="xs" color="gray.600" whiteSpace="pre-line">
                    {(uploadResult.reply as string)?.split('\n').slice(0, 5).join('\n')}
                  </Text>
                </Box>
              )}

              <Button
                bg="#155740" color="white" _hover={{ bg: '#1a7a57' }} borderRadius="10px"
                isLoading={uploading} isDisabled={!uploadFile} loadingText="Processing with AI…"
                onClick={handleUpload} leftIcon={<MdUploadFile />}
              >
                Process Invoice with AI
              </Button>
            </Flex>
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Create Invoice Modal */}
      <Modal isOpen={isCreateOpen} onClose={onCreateClose} size="2xl" scrollBehavior="inside">
        <ModalOverlay backdropFilter="blur(4px)" />
        <ModalContent borderRadius="16px">
          <ModalHeader fontSize="md" fontWeight="700">Create Invoice</ModalHeader>
          <ModalCloseButton />
          <ModalBody pb="4">
            <Flex direction="column" gap="14px">
              <Box>
                <FormLabel fontSize="xs" fontWeight="600" color="gray.600" mb="6px">Invoice Type</FormLabel>
                <Flex gap="10px">
                  {(['purchase', 'sale'] as const).map(t => (
                    <Button key={t} size="sm" variant={draftType === t ? 'solid' : 'outline'}
                      colorScheme="green" borderRadius="8px" onClick={() => setDraftType(t)} textTransform="capitalize">
                      {t === 'purchase' ? '🛒 Purchase' : '💰 Sale'}
                    </Button>
                  ))}
                </Flex>
              </Box>

              <Flex gap="12px" wrap="wrap">
                <Box flex="1" minW="140px">
                  <FormLabel fontSize="xs" color="gray.600" mb="4px">Invoice #</FormLabel>
                  <Input size="sm" borderRadius="8px" value={draftNumber}
                    onChange={e => setDraftNumber(e.target.value)} placeholder="INV-001" />
                </Box>
                <Box flex="1" minW="140px">
                  <FormLabel fontSize="xs" color="gray.600" mb="4px">
                    {draftType === 'purchase' ? 'Vendor Name' : 'Customer Name'}
                  </FormLabel>
                  <Input size="sm" borderRadius="8px" value={draftPartyName}
                    onChange={e => setDraftPartyName(e.target.value)} placeholder="Party name" />
                </Box>
                <Box flex="1" minW="140px">
                  <FormLabel fontSize="xs" color="gray.600" mb="4px">GSTIN (optional)</FormLabel>
                  <Input size="sm" borderRadius="8px" value={draftPartyGstin}
                    onChange={e => setDraftPartyGstin(e.target.value)} placeholder="22AAAAA0000A1Z5" />
                </Box>
              </Flex>

              <Flex gap="12px" wrap="wrap">
                <Box flex="1" minW="140px">
                  <FormLabel fontSize="xs" color="gray.600" mb="4px">Invoice Date</FormLabel>
                  <Input size="sm" borderRadius="8px" type="date" value={draftDate}
                    onChange={e => setDraftDate(e.target.value)} />
                </Box>
                <Box flex="1" minW="140px">
                  <FormLabel fontSize="xs" color="gray.600" mb="4px">Due Date (optional)</FormLabel>
                  <Input size="sm" borderRadius="8px" type="date" value={draftDueDate}
                    onChange={e => setDraftDueDate(e.target.value)} />
                </Box>
                <Box flex="1" minW="140px">
                  <FormLabel fontSize="xs" color="gray.600" mb="4px">Supply Type</FormLabel>
                  <Select size="sm" borderRadius="8px" value={draftSupply}
                    onChange={e => setDraftSupply(e.target.value as 'intrastate' | 'interstate')}>
                    <option value="intrastate">Intrastate (CGST + SGST)</option>
                    <option value="interstate">Interstate (IGST)</option>
                  </Select>
                </Box>
              </Flex>

              {/* Line items */}
              <Box>
                <Flex justify="space-between" align="center" mb="8px">
                  <Text fontSize="xs" fontWeight="600" color="gray.600">Line Items</Text>
                  <Button size="xs" leftIcon={<MdAdd />} variant="ghost" colorScheme="green" onClick={addDraftLine}>
                    Add Line
                  </Button>
                </Flex>
                <Box border="1px solid" borderColor="gray.200" borderRadius="10px" overflow="hidden">
                  <Table size="sm">
                    <Thead bg="gray.50">
                      <Tr>
                        <Th fontSize="10px">Description</Th>
                        <Th fontSize="10px" w="90px">HSN/SAC</Th>
                        <Th isNumeric fontSize="10px" w="64px">Qty</Th>
                        <Th isNumeric fontSize="10px" w="90px">Rate</Th>
                        <Th isNumeric fontSize="10px" w="70px">GST%</Th>
                        <Th isNumeric fontSize="10px" w="90px">Amount</Th>
                        <Th w="32px"></Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {computedLines.map((l, i) => (
                        <Tr key={i}>
                          <Td p="4px">
                            <Input size="xs" borderRadius="6px" value={l.description}
                              onChange={e => updateDraftLine(i, { description: e.target.value })}
                              placeholder="Item / service" />
                          </Td>
                          <Td p="4px">
                            <Input size="xs" borderRadius="6px" value={l.hsn_sac_code}
                              onChange={e => updateDraftLine(i, { hsn_sac_code: e.target.value })} />
                          </Td>
                          <Td p="4px">
                            <NumberInput size="xs" min={0} value={l.quantity}
                              onChange={v => updateDraftLine(i, { quantity: parseFloat(v) || 0 })}>
                              <NumberInputField borderRadius="6px" px="6px" />
                            </NumberInput>
                          </Td>
                          <Td p="4px">
                            <NumberInput size="xs" min={0} value={l.rate}
                              onChange={v => updateDraftLine(i, { rate: parseFloat(v) || 0 })}>
                              <NumberInputField borderRadius="6px" px="6px" />
                            </NumberInput>
                          </Td>
                          <Td p="4px">
                            <NumberInput size="xs" min={0} max={100} value={l.gst_rate}
                              onChange={v => updateDraftLine(i, { gst_rate: parseFloat(v) || 0 })}>
                              <NumberInputField borderRadius="6px" px="6px" />
                            </NumberInput>
                          </Td>
                          <Td isNumeric fontSize="xs" fontFamily="mono" fontWeight="600">
                            {fmt(l.amount)}
                          </Td>
                          <Td p="4px">
                            <IconButton aria-label="Remove line" icon={<MdDelete />} size="xs"
                              variant="ghost" colorScheme="red" onClick={() => removeDraftLine(i)} />
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                </Box>
              </Box>

              {/* Totals */}
              <Box bg="gray.50" borderRadius="10px" p="14px">
                <Flex justify="space-between" wrap="wrap" gap="12px">
                  <Box><Text fontSize="xs" color="gray.500">Subtotal</Text>
                    <Text fontSize="sm" fontWeight="600" fontFamily="mono">{fmt(draftSubtotal)}</Text></Box>
                  {draftCgst > 0 && <Box><Text fontSize="xs" color="gray.500">CGST</Text>
                    <Text fontSize="sm" fontFamily="mono" color="orange.600">{fmt(draftCgst)}</Text></Box>}
                  {draftSgst > 0 && <Box><Text fontSize="xs" color="gray.500">SGST</Text>
                    <Text fontSize="sm" fontFamily="mono" color="orange.600">{fmt(draftSgst)}</Text></Box>}
                  {draftIgst > 0 && <Box><Text fontSize="xs" color="gray.500">IGST</Text>
                    <Text fontSize="sm" fontFamily="mono" color="orange.600">{fmt(draftIgst)}</Text></Box>}
                  <Box><Text fontSize="xs" color="gray.500">Total</Text>
                    <Text fontSize="md" fontWeight="800" color="#155740" fontFamily="mono">{fmt(draftTotal)}</Text></Box>
                </Flex>
              </Box>
            </Flex>
          </ModalBody>
          <ModalFooter gap="10px">
            <Button variant="ghost" onClick={onCreateClose}>Cancel</Button>
            <Button bg="#155740" color="white" _hover={{ bg: '#1a7a57' }} borderRadius="10px"
              isLoading={creating} loadingText="Saving…" onClick={handleCreateInvoice}>
              Save {draftType === 'purchase' ? 'Purchase' : 'Sales'} Invoice
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}
