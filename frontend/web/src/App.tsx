import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface BackgroundCheck {
  id: string;
  name: string;
  position: string;
  timestamp: number;
  creator: string;
  isVerified: boolean;
  decryptedValue?: number;
  encryptedValueHandle?: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState<BackgroundCheck[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingCheck, setCreatingCheck] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newCheckData, setNewCheckData] = useState({ name: "", position: "", result: "" });
  const [selectedCheck, setSelectedCheck] = useState<BackgroundCheck | null>(null);
  const [decryptedResult, setDecryptedResult] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [stats, setStats] = useState({ total: 0, passed: 0, failed: 0 });
  const [faqOpen, setFaqOpen] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const checksList: BackgroundCheck[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          checksList.push({
            id: businessId,
            name: businessData.name,
            position: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setChecks(checksList);
      calculateStats(checksList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const calculateStats = (checks: BackgroundCheck[]) => {
    const passed = checks.filter(c => c.isVerified && c.decryptedValue === 1).length;
    const failed = checks.filter(c => c.isVerified && c.decryptedValue === 0).length;
    setStats({
      total: checks.length,
      passed,
      failed
    });
  };

  const createCheck = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingCheck(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating background check..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const resultValue = newCheckData.result === "pass" ? 1 : 0;
      const businessId = `check-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, resultValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newCheckData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newCheckData.position
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Check created!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewCheckData({ name: "", position: "", result: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingCheck(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Verified!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const handleCheckAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "System available" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Confidential Background Check</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>Connect Your Wallet</h2>
            <p>Please connect your wallet to access encrypted background checks.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system initialization</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Perform encrypted checks</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE System...</p>
        <p>Status: {fhevmInitializing ? "Initializing" : status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Confidential Background Check</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Check
          </button>
          <button 
            onClick={handleCheckAvailability}
            className="check-btn"
          >
            Check System
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <h2>Background Check Dashboard</h2>
          
          <div className="dashboard-panels">
            <div className="panel metal-panel">
              <h3>Total Checks</h3>
              <div className="stat-value">{stats.total}</div>
            </div>
            
            <div className="panel metal-panel">
              <h3>Passed</h3>
              <div className="stat-value passed">{stats.passed}</div>
            </div>
            
            <div className="panel metal-panel">
              <h3>Failed</h3>
              <div className="stat-value failed">{stats.failed}</div>
            </div>
          </div>
          
          <div className="chart-container">
            <h3>Verification Status</h3>
            <div className="chart">
              <div 
                className="chart-bar passed" 
                style={{ width: `${stats.total ? (stats.passed / stats.total) * 100 : 0}%` }}
              >
                <span>{stats.passed} Passed</span>
              </div>
              <div 
                className="chart-bar failed" 
                style={{ width: `${stats.total ? (stats.failed / stats.total) * 100 : 0}%` }}
              >
                <span>{stats.failed} Failed</span>
              </div>
            </div>
          </div>
        </div>
        
        <div className="checks-section">
          <div className="section-header">
            <h2>Background Checks</h2>
            <div className="header-actions">
              <button 
                onClick={loadData} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="checks-list">
            {checks.length === 0 ? (
              <div className="no-checks">
                <p>No background checks found</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Check
                </button>
              </div>
            ) : checks.map((check, index) => (
              <div 
                className={`check-item ${selectedCheck?.id === check.id ? "selected" : ""} ${check.isVerified ? (check.decryptedValue === 1 ? "passed" : "failed") : ""}`} 
                key={index}
                onClick={() => setSelectedCheck(check)}
              >
                <div className="check-title">{check.name}</div>
                <div className="check-position">{check.position}</div>
                <div className="check-status">
                  {check.isVerified ? 
                    (check.decryptedValue === 1 ? "✅ Passed" : "❌ Failed") : 
                    "🔓 Pending Verification"}
                </div>
                <div className="check-date">{new Date(check.timestamp * 1000).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="faq-section">
          <div className="faq-header" onClick={() => setFaqOpen(!faqOpen)}>
            <h2>Frequently Asked Questions</h2>
            <div className={`faq-toggle ${faqOpen ? "open" : ""}`}>▼</div>
          </div>
          
          {faqOpen && (
            <div className="faq-content">
              <div className="faq-item">
                <h3>How does FHE protect candidate privacy?</h3>
                <p>Fully Homomorphic Encryption allows background checks to be performed without revealing candidate details to the database.</p>
              </div>
              <div className="faq-item">
                <h3>What information is encrypted?</h3>
                <p>Only the background check result is encrypted. Candidate name and position are public metadata.</p>
              </div>
              <div className="faq-item">
                <h3>How is verification performed?</h3>
                <p>Offline decryption with on-chain proof verification ensures result integrity without exposing raw data.</p>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateCheck 
          onSubmit={createCheck} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingCheck} 
          checkData={newCheckData} 
          setCheckData={setNewCheckData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedCheck && (
        <CheckDetailModal 
          check={selectedCheck} 
          onClose={() => { 
            setSelectedCheck(null); 
            setDecryptedResult(null); 
          }} 
          decryptedResult={decryptedResult} 
          isDecrypting={isDecrypting} 
          decryptData={() => decryptData(selectedCheck.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateCheck: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  checkData: any;
  setCheckData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, checkData, setCheckData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setCheckData({ ...checkData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-check-modal">
        <div className="modal-header">
          <h2>New Background Check</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Check result will be encrypted with Zama FHE</p>
          </div>
          
          <div className="form-group">
            <label>Candidate Name *</label>
            <input 
              type="text" 
              name="name" 
              value={checkData.name} 
              onChange={handleChange} 
              placeholder="Enter candidate name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Position *</label>
            <input 
              type="text" 
              name="position" 
              value={checkData.position} 
              onChange={handleChange} 
              placeholder="Enter position..." 
            />
          </div>
          
          <div className="form-group">
            <label>Background Check Result *</label>
            <select 
              name="result" 
              value={checkData.result} 
              onChange={handleChange}
            >
              <option value="">Select result</option>
              <option value="pass">Pass</option>
              <option value="fail">Fail</option>
            </select>
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !checkData.name || !checkData.position || !checkData.result} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Check"}
          </button>
        </div>
      </div>
    </div>
  );
};

const CheckDetailModal: React.FC<{
  check: BackgroundCheck;
  onClose: () => void;
  decryptedResult: number | null;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ check, onClose, decryptedResult, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedResult !== null) return;
    
    const result = await decryptData();
    if (result !== null) {
      setDecryptedResult(result);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="check-detail-modal">
        <div className="modal-header">
          <h2>Background Check Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="check-info">
            <div className="info-item">
              <span>Candidate:</span>
              <strong>{check.name}</strong>
            </div>
            <div className="info-item">
              <span>Position:</span>
              <strong>{check.position}</strong>
            </div>
            <div className="info-item">
              <span>Date:</span>
              <strong>{new Date(check.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Background Check</h3>
            
            <div className="data-row">
              <div className="data-label">Result:</div>
              <div className="data-value">
                {check.isVerified ? 
                  (check.decryptedValue === 1 ? "✅ Passed (Verified)" : "❌ Failed (Verified)") : 
                  decryptedResult !== null ? 
                  (decryptedResult === 1 ? "✅ Passed (Decrypted)" : "❌ Failed (Decrypted)") : 
                  "🔒 Encrypted Result"
                }
              </div>
              {!check.isVerified && (
                <button 
                  className={`decrypt-btn ${decryptedResult !== null ? 'decrypted' : ''}`}
                  onClick={handleDecrypt} 
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "🔓 Verifying..." : "🔓 Verify Result"}
                </button>
              )}
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 Encryption Process</strong>
                <p>Result encrypted on-chain. Verification performs offline decryption and on-chain proof validation.</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;


