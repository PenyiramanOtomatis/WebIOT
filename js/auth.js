// ===============================
// AUTHENTICATION MODULE
// ===============================
import { auth, db } from './firebase-config.js';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  signOut, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  doc, 
  setDoc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ===============================
// LOGIN FUNCTION
// ===============================
export async function login(email, password) {
  try {
    // Sign in user with email and password
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    // Get user role from Firestore
    const userDocRef = doc(db, 'users', user.uid);
    const userDoc = await getDoc(userDocRef);
    
    if (userDoc.exists()) {
      const userData = userDoc.data();
      
      // Store user data in sessionStorage
      sessionStorage.setItem('userRole', userData.role);
      sessionStorage.setItem('userEmail', userData.email);
      sessionStorage.setItem('userName', userData.name);
      sessionStorage.setItem('userId', user.uid);
      
      console.log('Login berhasil:', userData);
      return { success: true, role: userData.role };
    } else {
      throw new Error('Data pengguna tidak ditemukan di database');
    }
  } catch (error) {
    console.error('Login error:', error);
    let errorMessage = 'Login gagal';
    
    // Handle specific error codes
    if (error.code === 'auth/invalid-credential') {
      errorMessage = 'Email atau password salah';
    } else if (error.code === 'auth/user-not-found') {
      errorMessage = 'Pengguna tidak ditemukan';
    } else if (error.code === 'auth/wrong-password') {
      errorMessage = 'Password salah';
    } else if (error.code === 'auth/invalid-email') {
      errorMessage = 'Format email tidak valid';
    } else if (error.code === 'auth/user-disabled') {
      errorMessage = 'Akun ini telah dinonaktifkan';
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    return { success: false, error: errorMessage };
  }
}

// ===============================
// REGISTER FUNCTION
// ===============================
export async function register(name, email, password, role = 'user') {
  try {
    // Validate input
    if (!name || name.trim().length < 3) {
      throw new Error('Nama harus minimal 3 karakter');
    }
    
    if (!email || !email.includes('@')) {
      throw new Error('Format email tidak valid');
    }
    
    if (!password || password.length < 6) {
      throw new Error('Password harus minimal 6 karakter');
    }
    
    // Create user with email and password
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    // Create user document in Firestore
    const userDocRef = doc(db, 'users', user.uid);
    await setDoc(userDocRef, {
      uid: user.uid,
      name: name.trim(),
      email: email.toLowerCase().trim(),
      role: role,
      createdAt: serverTimestamp(),
      lastLogin: serverTimestamp()
    });
    
    // Store user data in sessionStorage
    sessionStorage.setItem('userRole', role);
    sessionStorage.setItem('userEmail', email);
    sessionStorage.setItem('userName', name);
    sessionStorage.setItem('userId', user.uid);
    
    console.log('Registrasi berhasil:', { name, email, role });
    return { success: true, role: role };
  } catch (error) {
    console.error('Register error:', error);
    let errorMessage = 'Registrasi gagal';
    
    // Handle specific error codes
    if (error.code === 'auth/email-already-in-use') {
      errorMessage = 'Email sudah digunakan';
    } else if (error.code === 'auth/invalid-email') {
      errorMessage = 'Format email tidak valid';
    } else if (error.code === 'auth/weak-password') {
      errorMessage = 'Password terlalu lemah (minimal 6 karakter)';
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    return { success: false, error: errorMessage };
  }
}

// ===============================
// LOGOUT FUNCTION
// ===============================
export async function logout() {
  try {
    await signOut(auth);
    sessionStorage.clear();
    window.location.href = 'login.html';
    console.log('Logout berhasil');
  } catch (error) {
    console.error('Logout error:', error);
    alert('Gagal logout: ' + error.message);
  }
}

// ===============================
// CHECK AUTHENTICATION
// ===============================
export function checkAuth(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      // User is signed in, verify user role exists in Firestore
      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        
        // Update sessionStorage
        sessionStorage.setItem('userRole', userData.role);
        sessionStorage.setItem('userEmail', userData.email);
        sessionStorage.setItem('userName', userData.name);
        sessionStorage.setItem('userId', user.uid);
        
        // Call callback with user data
        if (callback) {
          callback(user, userData);
        }
      } else {
        // User authenticated but no data in Firestore
        console.warn('User data not found in Firestore, signing out...');
        await signOut(auth);
        window.location.href = 'login.html';
      }
    } else {
      // User is not signed in, redirect to login
      window.location.href = 'login.html';
    }
  });
}

// ===============================
// GET USER FUNCTIONS
// ===============================
export function getUserRole() {
  return sessionStorage.getItem('userRole');
}

export function getUserEmail() {
  return sessionStorage.getItem('userEmail');
}

export function getUserName() {
  return sessionStorage.getItem('userName');
}

export function getUserId() {
  return sessionStorage.getItem('userId');
}

// ===============================
// ROLE CHECKING
// ===============================
export function isAdmin() {
  return getUserRole() === 'admin';
}

export function isUser() {
  return getUserRole() === 'user';
}