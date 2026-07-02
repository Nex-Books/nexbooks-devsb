'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Badge, Box, Button, Flex, FormLabel, Icon, IconButton, Input, NumberInput,
  NumberInputField, Select, Spinner, Table, Tbody, Td, Text, Th, Thead, Tr, useToast,
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter,
  ModalCloseButton, useDisclosure,
} from '@chakra-ui/react';
import { MdAccountBalance, MdAdd, MdFileUpload, MdCheckCircle, MdWarning } from 'react-icons/md';
import { supabase } from 'lib/supabase';
import { useAuth } from 'context/AuthContext';

const API = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || 'http://localhost:8000';

const fmtSigned = (n: number) =>
  (n < 0 ? '(₹' : '₹') + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2 }) + (n < 0 ? ')' : '');

const RECEIPT_CATEGORIES = [
  { label: 'Sales Revenue', type: 'Income' },
  { label: 'Other Income', type: 'Income' },
  { label: 'Interest Income', type: 'Income' },
  { label: "Owner's Capital", type: 'Equity' },
  { label: 'Loan Received', type: 'Liability' },
  { label: 'Accounts Receivable', type: 'Asset' },
];

const PAYMENT_CATEGORIES = [
  { label: 'Rent Expense', type: 'Expense' },
  { label: 'Salary Expense', type: 'Expense' },
  { label: 'Utilities Expense', type: 'Expense' },
  { label: 'Purchase of Goods', type: 'Expense' },
  { label: 'Bank Charges', type: 'Expense' },
  { label: 'Office Supplies', type: 'Expense' },
  { label: 'Accounts Payable', type: 'Liability' },
  { label: 'Loan Repayment', type: 'Liability' },
];

export default function BankPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { isOpen: isEntryOpen, onOpen: onEntryOpen, onClose: onEntryClose } = useDisclosure();
  const [entryKind, setEntryKind] = useState<'Receipt' | 'Payment'>('Receipt');
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [entryDescription, setEntryDescription] = useState('');
  const [entryAmount, setEntryAmount] = useState(0);
  const [entryCategory, setEntryCategory] = useState(RECEIPT_CATEGORIES[0].label);
  const [entryReference, setEntryReference] = useState('');
  const [savingEntry, setSavingEntry] = useState(false);

  const categoryOptions = entryKind === 'Receipt' ? RECEIPT_CATEGORIES : PAYMENT_CATEGORIES;
  
  const getAuthHeader = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  }, []);

  const loadTransactions = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const headers = await getAuthHeader();
      const res = await fetch(`${API}/api/bank/transactions?user_id=${user.id}`, { headers });
      const data = await res.json();
      setTransactions(data.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [user, getAuthHeader]);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const headers = await getAuthHeader();
      const res = await fetch(`${API}/api/bank/upload-statement?user_id=${user.id}`, {
        method: 'POST',
        headers,
        body: formData,
      });

      if (res.ok) {
        toast({ title: 'Upload Successful', description: 'Bank statement imported successfully.', status: 'success' });
        loadTransactions();
      } else {
        const err = await res.json();
        throw new Error(err.detail || 'Upload failed');
      }
    } catch (err: any) {
      toast({ title: 'Upload Failed', description: err.message, status: 'error' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const openEntryModal = (kind: 'Receipt' | 'Payment') => {
    setEntryKind(kind);
    setEntryDate(new Date().toISOString().slice(0, 10));
    setEntryDescription('');
    setEntryAmount(0);
    setEntryCategory(kind === 'Receipt' ? RECEIPT_CATEGORIES[0].label : PAYMENT_CATEGORIES[0].label);
    setEntryReference('');
    onEntryOpen();
  };

  const handleSaveEntry = async () => {
    if (!user) return;
    if (!entryDescription.trim() || entryAmount <= 0) {
      toast({ title: 'Description and a positive amount are required', status: 'warning', duration: 2500 });
      return;
    }
    setSavingEntry(true);
    try {
      const cat = categoryOptions.find(c => c.label === entryCategory) || categoryOptions[0];
      const headers = { ...(await getAuthHeader()), 'Content-Type': 'application/json' };
      const res = await fetch(`${API}/api/bank/transactions?user_id=${user.id}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          transaction_date: entryDate,
          description: entryDescription.trim(),
          amount: entryAmount,
          transaction_type: entryKind,
          account_name: cat.label,
          account_type: cat.type,
          reference_number: entryReference.trim() || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed to save entry');
      toast({ title: `${entryKind} recorded`, status: 'success', duration: 2500 });
      onEntryClose();
      loadTransactions();
    } catch (err: any) {
      toast({ title: 'Failed to save entry', description: err.message, status: 'error' });
    } finally {
      setSavingEntry(false);
    }
  };

  const unreconciledCount = transactions.filter(t => t.status === 'unreconciled').length;

  return (
    <Box bg="gray.50" minH="100%">
      <Box px={{ base: '20px', md: '32px' }} pt="28px" pb="20px" bg="white" borderBottom="1px solid" borderColor="gray.200">
        <Flex justify="space-between" align="center" wrap="wrap" gap="16px">
          <Box>
            <Text fontSize="xl" fontWeight="800" color="gray.800" letterSpacing="-0.5px">Bank Reconciliation</Text>
            <Text fontSize="sm" color="gray.500" mt="2px">Match imported statements with journal entries</Text>
          </Box>
          <Flex gap="12px">
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".csv" style={{ display: 'none' }} />
            <Button
              size="sm" variant="outline" borderColor="green.600" color="green.700" borderRadius="10px"
              leftIcon={<MdAdd />} onClick={() => openEntryModal('Receipt')}
            >
              Add Receipt
            </Button>
            <Button
              size="sm" variant="outline" borderColor="red.500" color="red.600" borderRadius="10px"
              leftIcon={<MdAdd />} onClick={() => openEntryModal('Payment')}
            >
              Add Payment
            </Button>
            <Button
              size="sm" bg="#155740" color="white" _hover={{ bg: '#1a7a57' }} borderRadius="10px"
              leftIcon={<MdFileUpload />} onClick={() => fileInputRef.current?.click()} isLoading={uploading}
            >
              Import CSV Statement
            </Button>
          </Flex>
        </Flex>
      </Box>

      <Box px={{ base: '20px', md: '32px' }} py="20px">
        {loading && transactions.length === 0 ? (
          <Flex justify="center" py="60px"><Spinner size="lg" color="#155740" thickness="3px" /></Flex>
        ) : transactions.length === 0 ? (
          <Flex direction="column" align="center" py="60px" gap="12px" bg="white" borderRadius="14px" border="1px solid" borderColor="gray.200">
            <Icon as={MdAccountBalance} w="32px" h="32px" color="gray.300" />
            <Text color="gray.500">No bank transactions imported yet.</Text>
            <Text fontSize="sm" color="gray.400">Import a CSV statement to begin reconciliation.</Text>
            <Flex gap="10px" mt="10px">
              <Button size="sm" variant="outline" borderColor="green.600" color="green.700"
                onClick={() => openEntryModal('Receipt')}>Add Receipt</Button>
              <Button size="sm" variant="outline" borderColor="red.500" color="red.600"
                onClick={() => openEntryModal('Payment')}>Add Payment</Button>
              <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                Import CSV
              </Button>
            </Flex>
          </Flex>
        ) : (
          <>
            <Flex gap="16px" mb="24px">
              <Box bg="white" borderRadius="14px" border="1px solid" borderColor="gray.200" px="20px" py="16px" flex="1">
                <Text fontSize="xs" fontWeight="700" color="gray.500" mb="4px">UNRECONCILED</Text>
                <Text fontSize="2xl" fontWeight="800" color="red.600">{unreconciledCount}</Text>
              </Box>
              <Box bg="white" borderRadius="14px" border="1px solid" borderColor="gray.200" px="20px" py="16px" flex="1">
                <Text fontSize="xs" fontWeight="700" color="gray.500" mb="4px">RECONCILED</Text>
                <Text fontSize="2xl" fontWeight="800" color="#155740">{transactions.length - unreconciledCount}</Text>
              </Box>
            </Flex>

            <Box bg="white" borderRadius="14px" border="1px solid" borderColor="gray.200" overflow="hidden">
              <Table size="sm">
                <Thead bg="gray.50">
                  <Tr>
                    <Th fontSize="11px" py="12px">Date</Th>
                    <Th fontSize="11px">Description</Th>
                    <Th isNumeric fontSize="11px">Amount (₹)</Th>
                    <Th fontSize="11px">Type</Th>
                    <Th fontSize="11px">Status</Th>
                    <Th fontSize="11px">Action</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {transactions.map((t, i) => (
                    <Tr key={t.id} _hover={{ bg: 'gray.50' }}>
                      <Td fontSize="xs">{t.transaction_date}</Td>
                      <Td fontSize="sm" color="gray.800">{t.description}</Td>
                      <Td isNumeric fontSize="sm" fontFamily="mono" fontWeight="600" color={t.amount > 0 ? 'green.700' : 'red.600'}>
                        {fmtSigned(t.amount)}
                      </Td>
                      <Td>
                        <Badge colorScheme={t.amount > 0 ? 'green' : 'red'} fontSize="10px" borderRadius="5px">
                          {t.transaction_type}
                        </Badge>
                      </Td>
                      <Td>
                        <Badge colorScheme={t.status === 'reconciled' ? 'green' : 'orange'} fontSize="10px" borderRadius="5px">
                          {t.status}
                        </Badge>
                      </Td>
                      <Td>
                        {t.status === 'unreconciled' ? (
                          <Button size="xs" colorScheme="teal" variant="ghost">Match</Button>
                        ) : (
                          <Icon as={MdCheckCircle} color="green.500" />
                        )}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Box>
          </>
        )}
      </Box>

      {/* Manual Receipt / Payment Modal */}
      <Modal isOpen={isEntryOpen} onClose={onEntryClose} size="md">
        <ModalOverlay backdropFilter="blur(4px)" />
        <ModalContent borderRadius="16px">
          <ModalHeader fontSize="md" fontWeight="700">
            Add {entryKind === 'Receipt' ? 'Receipt' : 'Payment'} Entry
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody pb="4">
            <Flex direction="column" gap="14px">
              <Box>
                <FormLabel fontSize="xs" fontWeight="600" color="gray.600" mb="6px">Type</FormLabel>
                <Flex gap="10px">
                  <Button size="sm" variant={entryKind === 'Receipt' ? 'solid' : 'outline'}
                    colorScheme="green" borderRadius="8px"
                    onClick={() => { setEntryKind('Receipt'); setEntryCategory(RECEIPT_CATEGORIES[0].label); }}>
                    Receipt (Money In)
                  </Button>
                  <Button size="sm" variant={entryKind === 'Payment' ? 'solid' : 'outline'}
                    colorScheme="red" borderRadius="8px"
                    onClick={() => { setEntryKind('Payment'); setEntryCategory(PAYMENT_CATEGORIES[0].label); }}>
                    Payment (Money Out)
                  </Button>
                </Flex>
              </Box>

              <Flex gap="12px" wrap="wrap">
                <Box flex="1" minW="140px">
                  <FormLabel fontSize="xs" color="gray.600" mb="4px">Date</FormLabel>
                  <Input size="sm" borderRadius="8px" type="date" value={entryDate}
                    onChange={e => setEntryDate(e.target.value)} />
                </Box>
                <Box flex="1" minW="140px">
                  <FormLabel fontSize="xs" color="gray.600" mb="4px">Amount (₹)</FormLabel>
                  <NumberInput size="sm" min={0} value={entryAmount}
                    onChange={v => setEntryAmount(parseFloat(v) || 0)}>
                    <NumberInputField borderRadius="8px" />
                  </NumberInput>
                </Box>
              </Flex>

              <Box>
                <FormLabel fontSize="xs" color="gray.600" mb="4px">Description</FormLabel>
                <Input size="sm" borderRadius="8px" value={entryDescription}
                  onChange={e => setEntryDescription(e.target.value)}
                  placeholder={entryKind === 'Receipt' ? 'e.g. Payment received from customer' : 'e.g. Office rent for July'} />
              </Box>

              <Flex gap="12px" wrap="wrap">
                <Box flex="1" minW="140px">
                  <FormLabel fontSize="xs" color="gray.600" mb="4px">Category</FormLabel>
                  <Select size="sm" borderRadius="8px" value={entryCategory}
                    onChange={e => setEntryCategory(e.target.value)}>
                    {categoryOptions.map(c => (
                      <option key={c.label} value={c.label}>{c.label}</option>
                    ))}
                  </Select>
                </Box>
                <Box flex="1" minW="140px">
                  <FormLabel fontSize="xs" color="gray.600" mb="4px">Reference # (optional)</FormLabel>
                  <Input size="sm" borderRadius="8px" value={entryReference}
                    onChange={e => setEntryReference(e.target.value)} placeholder="Cheque / UTR no." />
                </Box>
              </Flex>
            </Flex>
          </ModalBody>
          <ModalFooter gap="10px">
            <Button variant="ghost" onClick={onEntryClose}>Cancel</Button>
            <Button
              bg={entryKind === 'Receipt' ? '#155740' : '#B91C1C'} color="white"
              _hover={{ opacity: 0.9 }} borderRadius="10px"
              isLoading={savingEntry} loadingText="Saving…" onClick={handleSaveEntry}
            >
              Save {entryKind}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}