'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Badge, Box, Button, Collapse, Flex, Icon, IconButton, Input, Modal,
  ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader,
  ModalOverlay, Select, Spinner, Table, Tbody, Td, Text, Th, Thead,
  Tooltip, Tr, useDisclosure, useToast, Tabs, TabList, Tab,
} from '@chakra-ui/react';
import {
  MdAdd, MdChevronRight, MdExpandMore, MdFilterList,
  MdRefresh, MdSearch, MdDeleteForever,
} from 'react-icons/md';
import { supabase } from 'lib/supabase';
import { useAuth } from 'context/AuthContext';

const API = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || 'http://localhost:8000';

const fmt = (n: number) =>
  '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2 });

interface JournalLine {
  account_name: string;
  account_type: string;
  debit: number;
  credit: number;
  description?: string;
}

interface JournalEntry {
  id: string;
  entry_date: string;
  description: string;
  reference_number?: string;
  transaction_type?: string;
  status?: string;
  source?: string;
  ai_generated?: boolean;
  total_debit?: number;
  total_credit?: number;
  total_amount?: number;
  lines: JournalLine[];
}

const STATUS_COLOR: Record<string, string> = {
  posted: 'green',
  draft: 'yellow',
  void: 'red',
};

const SOURCE_LABEL: Record<string, string> = {
  chat: 'AI Chat',
  invoice_upload: 'Invoice',
  manual: 'Manual',
};

// ─── Manual Entry Form ────────────────────────────────────────────────────────

interface ManualLine { account_name: string; account_type: string; debit: string; credit: string; description: string; }

const emptyLine = (): ManualLine => ({
  account_name: '', account_type: 'Asset', debit: '', credit: '', description: '',
});

// ─── Row component ────────────────────────────────────────────────────────────

function EntryRow({ entry, onVoid }: { entry: JournalEntry; onVoid: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const totalDebit = entry.total_debit ?? entry.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit = entry.total_credit ?? entry.lines.reduce((s, l) => s + (l.credit || 0), 0);
  const isVoid = entry.status === 'void';

  return (
    <>
      <Tr
        _hover={{ bg: 'gray.50' }}
        opacity={isVoid ? 0.5 : 1}
        cursor="pointer"
        onClick={() => setExpanded(e => !e)}
      >
        <Td py="12px" w="24px">
          <Icon
            as={expanded ? MdExpandMore : MdChevronRight}
            color="gray.400" w="18px" h="18px"
          />
        </Td>
        <Td fontSize="xs" color="gray.500" fontFamily="mono">
          {entry.entry_date}
        </Td>
        <Td fontSize="sm" color="gray.800" fontWeight="500" maxW="300px">
          <Text noOfLines={1}>{entry.description}</Text>
          {entry.reference_number && (
            <Text fontSize="10px" color="gray.400">{entry.reference_number}</Text>
          )}
        </Td>
        <Td>
          <Flex gap="4px" wrap="wrap">
            {entry.status && (
              <Badge colorScheme={STATUS_COLOR[entry.status] || 'gray'} fontSize="10px" borderRadius="5px">
                {entry.status}
              </Badge>
            )}
            {entry.source && (
              <Badge colorScheme="blue" variant="subtle" fontSize="10px" borderRadius="5px">
                {SOURCE_LABEL[entry.source] || entry.source}
              </Badge>
            )}
            {entry.ai_generated && (
              <Badge colorScheme="purple" variant="subtle" fontSize="10px" borderRadius="5px">
                AI
              </Badge>
            )}
          </Flex>
        </Td>
        <Td isNumeric fontSize="sm" fontFamily="mono" fontWeight="600" color="gray.800">
          {fmt(totalDebit)}
        </Td>
        <Td w="50px">
          {!isVoid && (
            <Tooltip label="Void entry" placement="left">
              <IconButton
                aria-label="Void"
                icon={<MdDeleteForever />}
                size="xs" variant="ghost" colorScheme="red"
                onClick={e => { e.stopPropagation(); onVoid(); }}
              />
            </Tooltip>
          )}
        </Td>
      </Tr>

      {/* Expanded lines */}
      {expanded && (
        <Tr>
          <Td colSpan={6} p="0" bg="gray.50" borderBottom="2px solid" borderColor="gray.200">
            <Box px="40px" py="12px">
              <Table size="sm" variant="simple">
                <Thead>
                  <Tr>
                    <Th fontSize="10px" color="gray.400">Account</Th>
                    <Th fontSize="10px" color="gray.400">Type</Th>
                    <Th isNumeric fontSize="10px" color="gray.400">Debit</Th>
                    <Th isNumeric fontSize="10px" color="gray.400">Credit</Th>
                    <Th fontSize="10px" color="gray.400">Narration</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {entry.lines.map((line, i) => (
                    <Tr key={i}>
                      <Td fontSize="xs" fontWeight={line.debit > 0 ? '600' : '400'}
                        pl={line.credit > 0 && line.debit === 0 ? '24px' : '0'}>
                        {line.account_name}
                      </Td>
                      <Td fontSize="xs" color="gray.500">{line.account_type}</Td>
                      <Td isNumeric fontSize="xs" fontFamily="mono" color="green.700">
                        {line.debit > 0 ? fmt(line.debit) : ''}
                      </Td>
                      <Td isNumeric fontSize="xs" fontFamily="mono" color="red.600">
                        {line.credit > 0 ? fmt(line.credit) : ''}
                      </Td>
                      <Td fontSize="xs" color="gray.400">{line.description || ''}</Td>
                    </Tr>
                  ))}
                  <Tr bg="gray.100">
                    <Td colSpan={2} fontSize="xs" fontWeight="700" color="gray.700">Total</Td>
                    <Td isNumeric fontSize="xs" fontFamily="mono" fontWeight="700">{fmt(totalDebit)}</Td>
                    <Td isNumeric fontSize="xs" fontFamily="mono" fontWeight="700">{fmt(totalCredit)}</Td>
                    <Td />
                  </Tr>
                </Tbody>
              </Table>
            </Box>
          </Td>
        </Tr>
      )}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function JournalPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { isOpen, onOpen, onClose } = useDisclosure();

  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterStatus, setFilterStatus] = useState('posted');
  const [searchAccount, setSearchAccount] = useState('');

  // Manual entry form
  const [manualLines, setManualLines] = useState<ManualLine[]>([emptyLine(), emptyLine()]);
  const [manualDesc, setManualDesc] = useState('');
  const [manualDate, setManualDate] = useState(new Date().toISOString().split('T')[0]);
  const [manualRef, setManualRef] = useState('');
  const [saving, setSaving] = useState(false);

  const getAuthHeader = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  };

  const loadEntries = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const headers = await getAuthHeader();
      const params = new URLSearchParams({
        user_id: user.id,
        page: String(page),
        limit: '15',
        ...(dateFrom && { date_from: dateFrom }),
        ...(dateTo && { date_to: dateTo }),
        ...(filterSource && { source: filterSource }),
        ...(filterStatus && { status: filterStatus }),
        ...(searchAccount && { account: searchAccount }),
      });
      const res = await fetch(`${API}/api/journal-entries?${params}`, { headers });
      const data = await res.json();
      setEntries(data.data || []);
      setTotal(data.total || 0);
      setTotalPages(data.total_pages || 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [user, page, dateFrom, dateTo, filterSource, filterStatus, searchAccount]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const voidEntry = async (entryId: string) => {
    if (!confirm('Void this journal entry? This cannot be undone.')) return;
    try {
      const headers = await getAuthHeader();
      const res = await fetch(`${API}/api/journal-entries/${entryId}/void?user_id=${user?.id}`, {
        method: 'POST',
        headers,
      });
      if (!res.ok) throw new Error('Void failed');
      toast({ title: 'Entry voided', status: 'success', duration: 2000 });
      // Optimistically remove from local state immediately
      setEntries(prev => prev.filter(e => e.id !== entryId));
      setTotal(prev => Math.max(0, prev - 1));
      // Then reload to sync with server
      loadEntries();
    } catch {
      toast({ title: 'Failed to void entry', status: 'error', duration: 2000 });
    }
  };

  const addManualLine = () => setManualLines(l => [...l, emptyLine()]);
  const removeLine = (i: number) => setManualLines(l => l.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: keyof ManualLine, val: string) =>
    setManualLines(l => l.map((line, idx) => idx === i ? { ...line, [field]: val } : line));

  const totalDr = manualLines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCr = manualLines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const balanced = Math.abs(totalDr - totalCr) < 0.01 && totalDr > 0;

  const handleManualSave = async () => {
    if (!manualDesc) { toast({ title: 'Description is required', status: 'warning', duration: 2000 }); return; }
    if (!balanced) { toast({ title: `Entry does not balance (Dr ₹${totalDr.toFixed(2)} ≠ Cr ₹${totalCr.toFixed(2)})`, status: 'error', duration: 3000 }); return; }

    const lines = manualLines
      .filter(l => l.account_name && (parseFloat(l.debit) || parseFloat(l.credit)))
      .map(l => ({
        account_name: l.account_name,
        account_type: l.account_type,
        debit: parseFloat(l.debit) || 0,
        credit: parseFloat(l.credit) || 0,
        description: l.description,
      }));

    setSaving(true);
    try {
      const headers = await getAuthHeader();
      const res = await fetch(`${API}/api/journal-entries?user_id=${user?.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ entry_date: manualDate, description: manualDesc, reference_number: manualRef, lines }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Save failed'); }
      toast({ title: 'Journal entry created', status: 'success', duration: 2000 });
      onClose();
      setManualLines([emptyLine(), emptyLine()]);
      setManualDesc(''); setManualRef('');
      loadEntries();
    } catch (e: unknown) {
      toast({ title: 'Error', description: (e as Error).message, status: 'error', duration: 3000 });
    } finally {
      setSaving(false);
    }
  };

  const getTabIndex = () => {
    if (filterStatus === 'posted') return 0;
    if (filterStatus === 'void') return 1;
    return 2;
  };

  const handleTabChange = (index: number) => {
    setPage(1);
    if (index === 0) setFilterStatus('posted');
    else if (index === 1) setFilterStatus('void');
    else setFilterStatus('');
  };

  return (
    <Box bg="gray.50" minH="100%">
      {/* Header */}
      <Box px={{ base: '20px', md: '32px' }} pt="28px" pb="0"
        bg="white" borderBottom="1px solid" borderColor="gray.200">
        <Flex align="center" justify="space-between" wrap="wrap" gap="12px" mb="16px">
          <Box>
            <Text fontSize="xl" fontWeight="800" color="gray.800" letterSpacing="-0.5px">
              Journal Entries
            </Text>
            <Text fontSize="sm" color="gray.500" mt="2px">
              {total} entries · Double-entry bookkeeping
            </Text>
          </Box>
          <Flex gap="8px">
            <IconButton aria-label="Refresh" icon={<MdRefresh />} size="sm" variant="ghost"
              onClick={loadEntries} isLoading={loading} />
            <Button leftIcon={<MdAdd />} size="sm" bg="#155740" color="white"
              _hover={{ bg: '#1a7a57' }} borderRadius="10px" onClick={onOpen}>
              New Entry
            </Button>
          </Flex>
        </Flex>

        {/* Status Slicer Tabs */}
        <Tabs colorScheme="green" variant="line" index={getTabIndex()} onChange={handleTabChange}>
          <TabList borderBottom="none">
            <Tab fontSize="sm" fontWeight="600" color="gray.500" _selected={{ color: '#155740', borderColor: '#155740' }} pb="12px">
              Active Entries
            </Tab>
            <Tab fontSize="sm" fontWeight="600" color="gray.500" _selected={{ color: '#EE5D50', borderColor: '#EE5D50' }} pb="12px">
              Deleted / Voided
            </Tab>
            <Tab fontSize="sm" fontWeight="600" color="gray.500" _selected={{ color: '#3965FF', borderColor: '#3965FF' }} pb="12px">
              All Records
            </Tab>
          </TabList>
        </Tabs>
      </Box>

      {/* Filters */}
      <Box px={{ base: '20px', md: '32px' }} py="16px">
        <Flex gap="10px" wrap="wrap" align="center">
          <Input
            size="sm" placeholder="From date" type="date" maxW="150px"
            value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }}
            bg="white" borderRadius="8px" borderColor="gray.200"
          />
          <Input
            size="sm" placeholder="To date" type="date" maxW="150px"
            value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }}
            bg="white" borderRadius="8px" borderColor="gray.200"
          />
          <Select size="sm" w="140px" bg="white" borderRadius="8px" borderColor="gray.200"
            value={filterSource} onChange={e => { setFilterSource(e.target.value); setPage(1); }}>
            <option value="">All Sources</option>
            <option value="chat">AI Chat</option>
            <option value="invoice_upload">Invoice</option>
            <option value="manual">Manual</option>
          </Select>
          <Flex align="center" bg="white" borderRadius="8px" border="1px solid" borderColor="gray.200"
            px="10px" gap="6px">
            <Icon as={MdSearch} color="gray.400" w="14px" h="14px" />
            <Input
              size="sm" placeholder="Filter by account…" border="none"
              value={searchAccount} onChange={e => { setSearchAccount(e.target.value); setPage(1); }}
              _focus={{ border: 'none', boxShadow: 'none' }} fontSize="sm" w="160px"
            />
          </Flex>
        </Flex>
      </Box>

      {/* Table */}
      <Box px={{ base: '20px', md: '32px' }} pb="32px">
        {loading ? (
          <Flex justify="center" py="60px">
            <Spinner size="lg" color="#155740" thickness="3px" />
          </Flex>
        ) : entries.length === 0 ? (
          <Flex direction="column" align="center" py="60px" gap="12px"
            bg="white" borderRadius="14px" border="1px solid" borderColor="gray.200">
            <Text fontSize="md" color="gray.500">No journal entries yet</Text>
            <Text fontSize="sm" color="gray.400">Use AI Assistant to record transactions, or create a manual entry.</Text>
            <Button size="sm" bg="#155740" color="white" _hover={{ bg: '#1a7a57' }}
              onClick={onOpen} leftIcon={<MdAdd />}>
              Create First Entry
            </Button>
          </Flex>
        ) : (
          <Box bg="white" borderRadius="14px" border="1px solid" borderColor="gray.200" overflow="hidden">
            <Table size="sm" variant="simple">
              <Thead bg="gray.50">
                <Tr>
                  <Th w="24px" />
                  <Th fontSize="11px" color="gray.500" py="12px">Date</Th>
                  <Th fontSize="11px" color="gray.500">Description</Th>
                  <Th fontSize="11px" color="gray.500">Tags</Th>
                  <Th isNumeric fontSize="11px" color="gray.500">Amount</Th>
                  <Th w="50px" />
                </Tr>
              </Thead>
              <Tbody>
                {entries.map(entry => (
                  <EntryRow key={entry.id} entry={entry} onVoid={() => voidEntry(entry.id)} />
                ))}
              </Tbody>
            </Table>

            {/* Pagination */}
            <Flex px="20px" py="12px" align="center" justify="space-between" borderTop="1px solid" borderColor="gray.100">
              <Text fontSize="xs" color="gray.500">
                {entries.length} of {total} entries
              </Text>
              <Flex gap="6px">
                <Button size="xs" variant="outline" isDisabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}>Prev</Button>
                <Button size="xs" variant="outline" isDisabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}>Next</Button>
              </Flex>
            </Flex>
          </Box>
        )}
      </Box>

      {/* Manual Entry Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="3xl">
        <ModalOverlay backdropFilter="blur(4px)" />
        <ModalContent borderRadius="16px">
          <ModalHeader fontSize="md" fontWeight="700">New Journal Entry</ModalHeader>
          <ModalCloseButton />
          <ModalBody pb="4">
            <Flex direction="column" gap="14px">
              <Flex gap="10px" wrap="wrap">
                <Box flex="2" minW="200px">
                  <Text fontSize="xs" fontWeight="600" color="gray.600" mb="4px">Description *</Text>
                  <Input size="sm" placeholder="e.g. Office rent payment – June 2024"
                    value={manualDesc} onChange={e => setManualDesc(e.target.value)} borderRadius="8px" />
                </Box>
                <Box>
                  <Text fontSize="xs" fontWeight="600" color="gray.600" mb="4px">Date *</Text>
                  <Input size="sm" type="date" value={manualDate}
                    onChange={e => setManualDate(e.target.value)} borderRadius="8px" w="150px" />
                </Box>
                <Box>
                  <Text fontSize="xs" fontWeight="600" color="gray.600" mb="4px">Reference</Text>
                  <Input size="sm" placeholder="JE-001" value={manualRef}
                    onChange={e => setManualRef(e.target.value)} borderRadius="8px" w="110px" />
                </Box>
              </Flex>

              {/* Lines */}
              <Box>
                <Flex align="center" justify="space-between" mb="8px">
                  <Text fontSize="xs" fontWeight="600" color="gray.600">Journal Lines</Text>
                  <Badge colorScheme={balanced ? 'green' : 'red'} fontSize="10px" borderRadius="6px" px="8px">
                    Dr ₹{totalDr.toFixed(2)} · Cr ₹{totalCr.toFixed(2)}
                    {balanced ? ' ✓ Balanced' : ' ✗ Unbalanced'}
                  </Badge>
                </Flex>

                <Table size="sm">
                  <Thead>
                    <Tr>
                      <Th fontSize="10px" color="gray.400">Account *</Th>
                      <Th fontSize="10px" color="gray.400">Type</Th>
                      <Th isNumeric fontSize="10px" color="gray.400">Debit (₹)</Th>
                      <Th isNumeric fontSize="10px" color="gray.400">Credit (₹)</Th>
                      <Th fontSize="10px" color="gray.400">Narration</Th>
                      <Th w="30px" />
                    </Tr>
                  </Thead>
                  <Tbody>
                    {manualLines.map((line, i) => (
                      <Tr key={i}>
                        <Td>
                          <Input size="xs" placeholder="Account name" value={line.account_name}
                            onChange={e => updateLine(i, 'account_name', e.target.value)} borderRadius="6px" />
                        </Td>
                        <Td>
                          <Select size="xs" value={line.account_type} borderRadius="6px"
                            onChange={e => updateLine(i, 'account_type', e.target.value)}>
                            {['Asset', 'Liability', 'Equity', 'Revenue', 'Expense'].map(t =>
                              <option key={t} value={t}>{t}</option>)}
                          </Select>
                        </Td>
                        <Td>
                          <Input size="xs" placeholder="0.00" type="number" textAlign="right"
                            value={line.debit} onChange={e => updateLine(i, 'debit', e.target.value)}
                            borderRadius="6px" fontFamily="mono" />
                        </Td>
                        <Td>
                          <Input size="xs" placeholder="0.00" type="number" textAlign="right"
                            value={line.credit} onChange={e => updateLine(i, 'credit', e.target.value)}
                            borderRadius="6px" fontFamily="mono" />
                        </Td>
                        <Td>
                          <Input size="xs" placeholder="Optional" value={line.description}
                            onChange={e => updateLine(i, 'description', e.target.value)} borderRadius="6px" />
                        </Td>
                        <Td>
                          {manualLines.length > 2 && (
                            <IconButton aria-label="Remove" icon={<MdDeleteForever />} size="xs"
                              variant="ghost" colorScheme="red" onClick={() => removeLine(i)} />
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
                <Button size="xs" variant="ghost" color="#155740" mt="8px"
                  leftIcon={<MdAdd />} onClick={addManualLine}>
                  Add Line
                </Button>
              </Box>
            </Flex>
          </ModalBody>
          <ModalFooter gap="8px">
            <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button size="sm" bg="#155740" color="white" _hover={{ bg: '#1a7a57' }}
              borderRadius="8px" isLoading={saving} isDisabled={!balanced}
              onClick={handleManualSave}>
              Create Entry
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}
