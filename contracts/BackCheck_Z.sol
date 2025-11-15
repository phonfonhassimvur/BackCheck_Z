pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract BackgroundCheck is ZamaEthereumConfig {
    struct Applicant {
        address applicantAddress;
        euint32 encryptedRecord;
        bool isVerified;
        bool passedCheck;
    }

    struct Employer {
        address employerAddress;
        string name;
        bool isActive;
    }

    mapping(address => Applicant) public applicants;
    mapping(address => Employer) public employers;
    mapping(address => bool) public registeredEmployers;

    address[] public applicantAddresses;
    address[] public employerAddresses;

    event ApplicantRegistered(address indexed applicant);
    event EmployerRegistered(address indexed employer);
    event BackgroundCheckCompleted(address indexed applicant, bool passed);

    constructor() ZamaEthereumConfig() {
    }

    function registerApplicant(externalEuint32 encryptedRecord, bytes calldata inputProof) external {
        require(!applicants[msg.sender].isVerified, "Applicant already registered");
        require(FHE.isInitialized(FHE.fromExternal(encryptedRecord, inputProof)), "Invalid encrypted input");

        applicants[msg.sender] = Applicant({
            applicantAddress: msg.sender,
            encryptedRecord: FHE.fromExternal(encryptedRecord, inputProof),
            isVerified: false,
            passedCheck: false
        });

        FHE.allowThis(applicants[msg.sender].encryptedRecord);
        FHE.makePubliclyDecryptable(applicants[msg.sender].encryptedRecord);

        applicantAddresses.push(msg.sender);
        emit ApplicantRegistered(msg.sender);
    }

    function registerEmployer(string calldata name) external {
        require(!registeredEmployers[msg.sender], "Employer already registered");

        employers[msg.sender] = Employer({
            employerAddress: msg.sender,
            name: name,
            isActive: true
        });
        registeredEmployers[msg.sender] = true;
        employerAddresses.push(msg.sender);
        emit EmployerRegistered(msg.sender);
    }

    function performBackgroundCheck(
        address applicant,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(registeredEmployers[msg.sender], "Caller is not a registered employer");
        require(!applicants[applicant].isVerified, "Applicant already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(applicants[applicant].encryptedRecord);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        bool passed = decodedValue == 0; // 0 indicates clean record

        applicants[applicant].isVerified = true;
        applicants[applicant].passedCheck = passed;

        emit BackgroundCheckCompleted(applicant, passed);
    }

    function getApplicantStatus(address applicant) external view returns (bool isVerified, bool passedCheck) {
        return (applicants[applicant].isVerified, applicants[applicant].passedCheck);
    }

    function getEmployerStatus(address employer) external view returns (bool isActive) {
        return employers[employer].isActive;
    }

    function getAllApplicants() external view returns (address[] memory) {
        return applicantAddresses;
    }

    function getAllEmployers() external view returns (address[] memory) {
        return employerAddresses;
    }

    function deactivateEmployer(address employer) external {
        require(msg.sender == employer, "Only employer can deactivate themselves");
        employers[employer].isActive = false;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


